from aws_lambda_powertools import Logger
from opensearchpy import (
    OpenSearch,
    RequestsHttpConnection,
    AWSV4SignerAuth,
)
import boto3
import os


logger = Logger(service="DeleteIndex")


def get_aoss_client(host_http):
    host = host_http

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


def delete_index(client, index_name):
    try:
        client.indices.delete(index_name)
        logger.info(f"Index {index_name} is successfylly deleted")
    except Exception as e:
        logger.info(f"Index {index_name} not found, nothing to delete")
        return True


def handler(event, context):
    host_http = os.environ["OPENSEARCH_ENDPOINT"]
    index_name = os.environ["INDEX_NAME"]
    if "index_name" in event.keys():
        index_name = event["index_name"]

    client = get_aoss_client(host_http)
    delete_index(client, index_name)

    logger.info("Process finished.")
