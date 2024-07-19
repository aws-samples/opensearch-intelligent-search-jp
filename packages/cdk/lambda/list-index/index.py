import json
import os
import boto3
import requests
from botocore.exceptions import NoCredentialsError, PartialCredentialsError
from aws_lambda_powertools import Logger
from opensearchpy import (
    OpenSearch,
    RequestsHttpConnection,
    AWSV4SignerAuth,
)

logger = Logger(service="ListIndex")

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
    client = get_aos_client(endpoint)

    headers = {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
    }

    try:
        index_list = client.cat.indices(format="json")
        indices = [idx['index'] for idx in index_list if not idx['index'].startswith('.')]
        return {
            'statusCode': 200,
            'headers': headers,
            'body': json.dumps({
                'indices': indices
            })
        }
        
    except Exception as e:
        logger.exception("Handler encountered an unexpected error")
        return {
            'statusCode': 500,
            'headers': headers,
            'body': json.dumps({
                'error': 'Internal Server Error'
            })
        }