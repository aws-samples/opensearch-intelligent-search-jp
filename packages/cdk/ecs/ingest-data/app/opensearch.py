from opensearchpy import (
    OpenSearch,
    RequestsHttpConnection,
    AWSV4SignerAuth,
    helpers,
)
import boto3
import json
import time
import re
import utils
from concurrent.futures import ThreadPoolExecutor


class OpenSearchController:
    def __init__(self, cfg):
        self.cfg = cfg
        self.bedrock_runtime = boto3.client(
            service_name="bedrock-runtime",
            region_name=cfg["bedrock_region"],
        )
        self.aos_client = self.get_aos_client()

    def get_aos_client(self):
        host = self.cfg["host_http"]
        region = host.split(".")[1]

        service = "es"
        credentials = boto3.Session().get_credentials()
        auth = AWSV4SignerAuth(credentials, region, service)

        client = OpenSearch(
            hosts=[{"host": host, "port": 443}],
            http_auth=auth,
            use_ssl=True,
            verify_certs=True,
            connection_class=RequestsHttpConnection,
            pool_maxsize=20,
        )

        return client

    def init_cluster_settings(self):
        # インデックス時のスレッド数を指定
        self.aos_client.cluster.put_settings(
            body={
                "persistent": {
                    "knn.algo_param.index_thread_qty": "4",
                }
            }
        )

    def create_index(self):
        index_name = self.cfg["index_name"]
        model_id = self.cfg["model_id"]
        dimension = self.cfg["dimension"]

        if not self.aos_client.indices.exists(index_name):
            print("create index")

            self.aos_client.indices.create(
                index_name,
                body={
                    "settings": {
                        "index": {
                            "analysis": {
                                "filter": {
                                    "custom_sudachi_part_of_speech": {
                                        "type": "sudachi_part_of_speech",
                                        "stoptags": [
                                            "感動詞,フィラー",
                                            "接頭辞",
                                            "代名詞",
                                            "助詞",
                                            "助動詞",
                                            "動詞,一般,*,*,*,終止形-一般",
                                            "名詞,普通名詞,副詞可能"
                                        ]
                                    }
                                },
                                "analyzer": {
                                    "custom_sudachi_analyzer": {
                                        "filter": [
                                            "sudachi_normalizedform",
                                            "custom_sudachi_part_of_speech"
                                        ],
                                        "char_filter": [
                                            "icu_normalizer"
                                        ],
                                        "type": "custom",
                                        "tokenizer": "sudachi_tokenizer"
                                    }
                                }
                            },
                            "knn": True,
                            # インデックス時のパフォーマンスを考慮して refresh_interval を大きく設定
                            "refresh_interval": "1000s",
                        }
                    },
                    "mappings": {
                        "_meta": {"model_id": model_id},
                        "properties": {
                            "vector": {
                                "type": "knn_vector",
                                "dimension": dimension,
                                "method": {
                                    "engine": "lucene",
                                    "space_type": "cosinesimil",
                                    "name": "hnsw",
                                    "parameters": {},
                                },
                            },
                            "docs_root": {"type": "keyword"},
                            "doc_name": {"type": "keyword"},
                            "keyword": {"type": "text", "analyzer": "custom_sudachi_analyzer"},
                            "service": {"type": "keyword"},
                        },
                    },
                },
            )

        print("Index was created.")
        time.sleep(20)

    def split_text(self, text):
        chunks = []
        current_chunk = ""
        current_length = 0
        max_length = self.cfg["max_chunk_length"]

        # for English sentences
        period_pattern = re.compile(r"[.!?][\s]")

        # for Japanese sentences
        kuten_pattern = re.compile(r"[。！？…\n]")

        split_pattern = re.compile(
            rf"(.{{1,{max_length}}}?({period_pattern.pattern}|{kuten_pattern.pattern}))",
            flags=re.DOTALL,
        )
        find = split_pattern.finditer(text)

        while list(find)[0].span()[0] != 0:
            max_length += 10
            split_pattern = re.compile(
                rf"(.{{1,{max_length}}}?({period_pattern.pattern}|{kuten_pattern.pattern}))",
                flags=re.DOTALL,
            )
            find = split_pattern.finditer(text)

        for match in split_pattern.finditer(text):
            chunk = match.group(1)
            chunk_length = len(chunk)

            if current_length + chunk_length <= max_length:
                current_chunk += chunk
                current_length += chunk_length
            else:

                chunks.append(current_chunk)
                current_chunk = chunk
                current_length = chunk_length

        chunks.append(current_chunk)

        return chunks

    def embed_file(self, file_name):

        text = utils.read_file(file_name)

        chunks = self.split_text(text)

        vectors = []
        for chunk in chunks:
            # API schema is adjust to Titan embedding model
            body = json.dumps({"inputText": chunk})
            query_response = self.bedrock_runtime.invoke_model(
                body=body,
                modelId=self.cfg["model_id"],
                accept="application/json",
                contentType="application/json",
            )
            vectors.append(
                json.loads(query_response["body"].read()).get("embedding")
            )

        return vectors, chunks

    def parse_response(query_response):

        response_body = json.loads(query_response.get("body").read())
        return response_body.get("embedding")

    def embed_documents(self, file_list):
        vectors = []
        counter = 0
        for file_name in file_list:
            print(f"embedding: {counter}/{len(file_list)}")
            counter += 1
            try:
                chunk_vectors, texts = self.embed_file(file_name)

            except Exception as e:
                continue

            for i, embedding in enumerate(chunk_vectors):
                vectors.append(
                    {
                        "_index": self.cfg["index_name"],
                        "vector": embedding,
                        "docs_root": "/".join(file_name.split("/")[:3]),
                        "doc_name": "/".join(file_name.split("/")[3:]),
                        "keyword": texts[i],
                        "service": file_name.split("/")[-2],
                    }
                )

        print(
            f"{len(file_list)} documents ({len(vectors)} chunks) were embedded."
        )
        return vectors

    def create_search_pipeline(self):
        # collapse-hybrid-search-pipeline の作成
        index_body = {
            "description": "Pipeline for hybrid search and collapse",
            "phase_results_processors": [
                {
                    "normalization-processor": {
                        "normalization": {"technique": "min_max"},
                        "combination": {
                            "technique": "arithmetic_mean",
                            "parameters": {"weights": [0.5, 0.5]},
                        },
                    }
                }
            ],
            "response_processors": [
                {
                    "collapse": {
                        "field": "doc_name"
                    }
                }
            ]
        }

        self.aos_client.http.put(
            "/_search/pipeline/collapse-hybrid-search-pipeline", body=index_body
        )

        # collapse-search-pipeline の作成
        index_body = {
            "description": "Pipeline for collapse",
            "response_processors": [
                {
                    "collapse": {
                        "field": "doc_name"
                    }
                }
            ]
        }

        self.aos_client.http.put(
            "/_search/pipeline/collapse-search-pipeline", body=index_body
        )

        # hybrid-search-pipeline の作成
        index_body = {
            "description": "Pipeline for hybrid search",
            "phase_results_processors": [
                {
                    "normalization-processor": {
                        "normalization": {"technique": "min_max"},
                        "combination": {
                            "technique": "arithmetic_mean",
                            "parameters": {"weights": [0.5, 0.5]},
                        },
                    }
                }
            ],
        }

        self.aos_client.http.put(
            "/_search/pipeline/hybrid-search-pipeline", body=index_body
        )

    def update_index(self):
        # index 作成時に大きく設定していた refresh_interval を元に戻す
        index_name = self.cfg["index_name"]
        self.aos_client.indices.put_settings(
            index=index_name,
            body={"index": {"refresh_interval": "60s"}},
        )

    def ingest_data(self):
        self.init_cluster_settings()
        self.create_search_pipeline()
        self.create_index()
        docs_url = self.cfg["docs_url"]

        file_list = utils.get_all_filepath(docs_url)

        with ThreadPoolExecutor(max_workers=8) as executor:
            thread = executor.submit(self.embed_documents, file_list)
        vectors = thread.result()

        batch_size = 50
        for i in range(0, len(vectors), batch_size):
            helpers.bulk(
                self.aos_client,
                vectors[i: min(i + batch_size, len(vectors))],
                request_timeout=1000,
            )

        self.update_index()

        print("Process finished.")
