import boto3
import json
import time

opensearch = boto3.client('opensearch')


def handler(event, context):
    print("Received event: " + json.dumps(event, indent=2))

    domain_name = event['ResourceProperties']['DomainName']

    if event['RequestType'] == 'Create':
        # OpenSearch ドメインが作成完了してから、Package を Associate 可能になるまで時間がかかることがあるため、一定時間待機
        time.sleep(120)

        # OpenSearch ドメインが既に作成されているか確認。Domain Status の processing が true だった場合は待機
        while True:
            res = opensearch.describe_domain(
                DomainName=domain_name
            )

            if res['DomainStatus']['Processing'] is False:
                break

            time.sleep(10)

        # OpenSearch 2.13 用の Sudachi Package ID を取得する（リージョンによって ID が変わる）
        res = opensearch.describe_packages(
            Filters=[
                {
                    "Name": "PackageName",
                    "Value": ["analysis-sudachi"]
                },
                {
                    "Name": "EngineVersion",
                    "Value": ["OpenSearch_2.13"]
                }]
        )

        package_id = res['PackageDetailsList'][0]['PackageID']

        res = opensearch.list_domains_for_package(
            PackageID=package_id
        )

        # もし該当のドメインにパッケージがまだ Associate されていない場合は、Associate する
        skip_association = False
        for detail in res['DomainPackageDetailsList']:
            if detail['DomainName'] == domain_name:
                skip_association = True

        if not skip_association:
            opensearch.associate_package(
                DomainName=domain_name,
                PackageID=package_id
            )

        return {"package_id": package_id}
    if event['RequestType'] == 'Delete':
        return {}
    if event['RequestType'] == 'Update':
        return {}


def is_complete(event, context):
    print("Received event: " + json.dumps(event, indent=2))

    domain_name = event['ResourceProperties']['DomainName']

    if event['RequestType'] == 'Create':
        package_id = event['package_id']

        res = opensearch.list_domains_for_package(
            PackageID=package_id
        )

        # もし domain_name に一致するドメインがあり、そのドメインのステータスが ACTIVE だった場合は、complete とする
        for detail in res['DomainPackageDetailsList']:
            if detail['DomainName'] == domain_name and detail['DomainPackageStatus'] == 'ACTIVE':
                return {'IsComplete': True}

    elif event['RequestType'] == 'Delete':
        return {'IsComplete': True}

    elif event['RequestType'] == 'Update':
        return {'IsComplete': True}

    return {'IsComplete': False}
