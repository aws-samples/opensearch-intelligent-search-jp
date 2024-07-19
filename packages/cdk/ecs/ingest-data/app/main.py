import argparse
import os
import requests

from opensearch import OpenSearchController
from utils import *


METADATA_URI = os.environ.get("ECS_CONTAINER_METADATA_URI_V4")


def get_exec_id() -> str:
    # Get task id from ECS metadata
    # Ref: https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-metadata-endpoint-v4.html#task-metadata-endpoint-v4-enable
    response = requests.get(f"{METADATA_URI}/task")
    data = response.json()
    task_arn = data.get("TaskARN", "")
    task_id = task_arn.split("/")[-1]
    return task_id


def ingest_data(
    host_http, index_name, dimension, model_id, docs_url, bedrock_region
):

    exec_id = ""
    try:
        exec_id = get_exec_id()
    except Exception as e:
        print(f"[ERROR] Failed to get exec_id: {e}")
        exec_id = "FAILED_TO_GET_ECS_EXEC_ID"

    print("exec_id:", exec_id)

    cfg = {
        "host_http": host_http,
        "index_name": index_name,
        "dimension": dimension,
        "model_id": model_id,
        "docs_url": docs_url,
        "bedrock_region": bedrock_region,
        "max_chunk_length": 400,
    }

    opensearch = OpenSearchController(cfg)
    opensearch.ingest_data()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--host-http",
        type=str,
        default=os.environ.get("OPENSEARCH_ENDPOINT", ""),
    )
    args = parser.parse_args()

    index_name = os.environ.get("OPENSEARCH_INDEX_NAME", "")
    dimension = os.environ.get("EMBED_DIMENSION", 1024)
    model_id = os.environ.get("EMBED_MODEL_ID", "amazon.titan-embed-text-v2:0")
    docs_url = os.environ.get("DOCUMENT_S3_URI", "")
    bedrock_region = os.environ.get("BEDROCK_REGION", "")

    ingest_data(
        args.host_http,
        index_name,
        dimension,
        model_id,
        docs_url,
        bedrock_region,
    )

    print("Data ingestion was completed.")
