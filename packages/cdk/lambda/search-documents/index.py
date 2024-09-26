from aws_lambda_powertools import Logger
from opensearchpy import (
    OpenSearch,
    RequestsHttpConnection,
    AWSV4SignerAuth,
)
import boto3
import json
import os

logger = Logger(service="SearchDocuments")
bedrock_runtime = boto3.client(
    service_name="bedrock-runtime", region_name=os.environ["BEDROCK_REGION"]
)


def get_vector(client, text, index_name):
    # モデル ID を取得
    model_id = client.indices.get(index=index_name)[index_name]["mappings"][
        "_meta"
    ]["model_id"]

    if "cohere" in model_id:
        body = json.dumps(
            {
                "texts": [text],
                "input_type": "search_query",
                "embedding_types": ["float"],
            }
        )
        query_response = bedrock_runtime.invoke_model(
            body=body,
            modelId=model_id,
            accept="*/*",
            contentType="application/json",
        )
        vector = json.loads(query_response["body"].read()).get("embeddings")[
            "float"
        ][0]
    else:

        # Bedrock のモデルからベクトルを取得
        query_response = bedrock_runtime.invoke_model(
            body=json.dumps({"inputText": text}),
            modelId=model_id,
            accept="application/json",
            contentType="application/json",
        )

        vector = json.loads(query_response["body"].read()).get("embedding")

    return vector


def find_similar_docs(client, search_query, index_name, search_pipeline=None):
    if search_pipeline:
        results = client.search(
            index=index_name, body=search_query, search_pipeline=search_pipeline
        )
    else:
        results = client.search(index=index_name, body=search_query)

    search_results = []
    for hit in results["hits"]["hits"]:
        search_results.append(
            {
                "text": hit["fields"]["keyword"][0],
                "score": hit["_score"],
                "service": hit["fields"]["service"][0],
                "docs_root": hit["fields"]["docs_root"][0],
                "doc_name": hit["fields"]["doc_name"][0],
            }
        )
    return search_results


def find_similar_docs_keyword(client, text, index_name, search_result_unit):
    search_query = {
        "size": 5,
        "_source": False,
        "fields": ["keyword", "service", "docs_root", "doc_name"],
        "query": {"match": {"keyword": {"query": text}}},
    }
    if search_result_unit == "document":
        search_pipeline = "collapse-search-pipeline"
    elif search_result_unit == "chunk":
        search_pipeline = None
    else:
        raise ValueError("Invalid search result unit")
    return find_similar_docs(client, search_query, index_name, search_pipeline)


def find_similar_docs_vector(client, vector, index_name, search_result_unit):
    search_query = {
        "size": 5,
        "_source": False,
        "fields": ["keyword", "service", "docs_root", "doc_name"],
        "query": {"knn": {"vector": {"vector": vector, "k": 5}}},
    }
    if search_result_unit == "document":
        search_pipeline = "collapse-search-pipeline"
    elif search_result_unit == "chunk":
        search_pipeline = None
    else:
        raise ValueError("Invalid search result unit")
    return find_similar_docs(client, search_query, index_name, search_pipeline)


def find_similar_docs_hybrid(
    client, vector, text, index_name, search_result_unit
):
    search_query = {
        "size": 5,
        "_source": False,
        "fields": ["keyword", "service", "docs_root", "doc_name"],
        "query": {
            "hybrid": {
                "queries": [
                    {"match": {"keyword": {"query": text}}},
                    {"knn": {"vector": {"vector": vector, "k": 5}}},
                ]
            }
        },
    }

    if search_result_unit == "document":
        search_pipeline = "collapse-hybrid-search-pipeline"
    elif search_result_unit == "chunk":
        search_pipeline = "hybrid-search-pipeline"
    else:
        raise ValueError("Invalid search result unit")
    return find_similar_docs(client, search_query, index_name, search_pipeline)


def get_aos_client(endpoint):
    host = endpoint
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


def handler(event, context):
    endpoint = os.environ["OPENSEARCH_ENDPOINT"]

    body = json.loads(event["body"])
    client = get_aos_client(endpoint)

    index_name = body["indexName"]
    text = body["text"]
    search_method = body["searchMethod"]
    search_result_unit = body["searchResultUnit"]

    headers = {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
    }

    try:
        if search_method == "hybrid":
            vector = get_vector(client, text, index_name)
            search_results = find_similar_docs_hybrid(
                client, vector, text, index_name, search_result_unit
            )

        elif search_method == "vector":
            vector = get_vector(client, text, index_name)
            search_results = find_similar_docs_vector(
                client, vector, index_name, search_result_unit
            )

        elif search_method == "keyword":
            search_results = find_similar_docs_keyword(
                client, text, index_name, search_result_unit
            )

        else:
            return {
                "statusCode": 400,
                "headers": headers,
                "body": json.dumps({"error": "invalid search method"}),
            }

        return {
            "statusCode": 200,
            "headers": headers,
            "body": json.dumps(search_results, ensure_ascii=False),
        }

    except ValueError as e:
        logger.error(f"Handler encountered a ValueError: {e}")
        return {
            "statusCode": 400,
            "headers": headers,
            "body": json.dumps({"error": str(e)}),
        }

    except Exception as e:
        logger.exception("Handler encountered an unexpected error")
        return {
            "statusCode": 500,
            "headers": headers,
            "body": json.dumps({"error": "Internal server error"}),
        }
