# 実装詳細

このドキュメントでは、実装の詳細について解説します。

- [全体構成](#全体構成)
- [主要コンポーネントの詳細](#主要コンポーネントの詳細)
  - [OpenSearch インデックス](#opensearch-インデックス)
    - [検索方法と検索単位](#検索方法と検索単位)
    - [マッピング定義](#マッピング定義)
  - [データ取り込み処理](#データ取り込み処理)
  - [検索パイプライン](#検索パイプライン)
    - [collapse-hybrid-search-pipeline](#collapse-hybrid-search-pipeline)
    - [collapse-search-pipeline](#collapse-search-pipeline)
    - [hybrid-search-pipeline](#hybrid-search-pipeline)

## 全体構成

本アセットのリポジトリ構成は以下の通りです。

```
.
├── README.md
├── docs  # 本アセットのドキュメント
├── docs.zip  # サンプルデータ
├── package-lock.json
├── package.json
├── packages
│   ├── cdk  # CDK コード
│   └── ui  # フロント UI 用コード
└── run-ingest-ecs-task.sh  # データ取り込み処理用シェルスクリプト
```

NPM の workspaces を用いた monorepo 構成となっており、packages ディレクトリ以下に cdk 用のパッケージと フロント UI 用のパッケージから構成されています。

## 主要コンポーネントの詳細

### OpenSearch インデックス

#### 検索方法と検索単位

このサンプル実装では、検索方法としてキーワード検索、ベクトル検索、ハイブリッド検索の 3 種類に対応しています。

- キーワード検索
  - キーワード検索は Okapi BM25 アルゴリズムを使ってドキュメントのスコアを計算します。検索クエリをトークンに分割し、そのトークンがドキュメント内に多く現れるか、トークンが一般的な単語 (例: the) ではないか、などを考慮して類似性を測ります。
  - 本アセットではトークン化を行うトークナイザーとして Sudachi を利用しています。Sudachi の設定内容は [opensearch.py](../packages/cdk/ecs/ingest-data/app/opensearch.py) を参照ください。
- ベクトル検索
  - ベクトル検索は、文書を機械学習モデルを使ってベクトル化し、そのベクトル間の類似度を測定してドキュメントのスコアを計算します。キーワード検索がキーワードの一致によってスコアを計算していたのに対し、ベクトル検索はより意味的な類似性を考慮してスコアを計算します。
- ハイブリッド検索 (キーワード検索 + ハイブリッド検索)
  - ハイブリッド検索は、キーワード検索とハイブリッド検索を合わせた検索手法です。
  - 本アセットでは、OpenSearch の持つ [Hybrid search](https://opensearch.org/docs/latest/search-plugins/hybrid-search/) 機能を利用しています。

また、検索の用途に合わせて document モードと chunk モードという 2 つの検索単位でドキュメントを検索することが可能です。

- document モード
  - document 単位で検索結果を返します。例えば、データソースにファイル A とファイル B があった時、OpenSearch では chunk A-1、chunk A-2、chunk B-1、chunk B-2、chunk B-3 のように保存されています。この時この検索モードでは、同じファイルのデータが複数返ってくることはありません。つまり、これらのチャンクの中で検索クエリとの関連度が高い順にソートされ、同じドキュメントのチャンクであれば最もスコアの高いチャンクのみ返却されます。
  - 主要なユースケースはドキュメント検索です。
  - 内部的には [collapse processor](https://opensearch.org/docs/latest/search-plugins/search-pipelines/collapse-processor/) を使用しています
- chunk モード
  - chunk 単位で検索結果を返します。document モードでは同じドキュメントで結果が重複しないような処理が行われましたが、chunk モードでは重複排除が行われません。
  - 主要なユースケースは RAG です。

#### マッピング定義

このサンプル実装における、Amazon OpenSearch Service のインデックスのマッピング定義は以下の通りです。検索結果のフィルタに使用したい項目を増やす場合は、ここにその項目を追加する必要があります。

```json
"mappings": {
    "_meta": {"model_id": model_id},           # テキスト埋め込みに使用するモデルの ID
    "properties": {
        "vector": {                            # ベクトル検索用ベクトルデータ
            "type": "knn_vector",
            "dimension": dimension,            # テキスト埋め込みベクトルの次元数
            "method": {
                "engine": "lucene",
                "space_type": "cosinesimil",
                "name": "hnsw",
                "parameters": {},
            },
        },
        "docs_root": {"type": "keyword"},      # ドキュメントが格納されている S3 パス
        "doc_name": {"type": "keyword"},       # ドキュメント名
        "keyword": {"type": "text", "analyzer": "custom_sudachi_analyzer"},  # テキスト検索用テキスト
        "service": {"type": "keyword"},        # 検索結果のフィルタに使うための情報
    },
}
```

ベクトル検索に必要なベクトルデータ vector と、vector と対になる、テキスト検索に必要なテキストデータ keyword をはじめとして、データの大元のドキュメントが格納されているファイル格納パスの docs_root, doc_name や、ドキュメントの属性 service（このサンプルでは AWS サービス名）などが設定されています。

### データ取り込み処理

データ取込用の ECS タスクでは、以下の処理を実行しています。

- OpenSearch インデックスの作成
  - インデックスに登録したい項目を変更したい場合は、packages/cdk/ecs/ingest-data/app/opensearch.py の create_index() を変更してください。
- 指定された S3 パスにあるドキュメントをテキストに変換
  - テキストファイルと PDF ファイルのみ動作確認済みです。その他のファイル形式の読み込みに対応する場合は、packages/cdk/ecs/ingest-data/app/utils.py の read_file() を変更してください。
- 変換したテキストをチャンク分割
  - 指定された文字数以内のキリの良い位置でチャンク分割する実装になっています。チャンク分割ロジックを変更したい場合は、packages/cdk/ecs/ingest-data/app/opensearch.py の split_text() を変更してください。
- チャンクをベクトルに変換
  - Titan embeddings v2 を使う実装になっています。埋め込みモデルを変更したい場合は、packages/cdk/ecs/ingest-data/app/opensearch.py の embed_file() を変更してください。
- ベクトルとその他の関連データを OpenSearch インデックスに登録

### 検索パイプライン

このサンプル実装では、ドキュメント単位の検索機能とハイブリッド検索機能を OpenSearch の検索パイプライン機能を使って実現しています。実装されている検索パイプラインは以下の 3種類です。

#### collapse-hybrid-search-pipeline

ドキュメント単位検索とハイブリッド検索を組み合わせた検索パイプライン。

```python
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
```

#### collapse-search-pipeline

ドキュメント単位検索のための検索パイプライン。

```python
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
```

#### hybrid-search-pipeline

ハイブリッド検索のための検索パイプライン。

```python
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
```
