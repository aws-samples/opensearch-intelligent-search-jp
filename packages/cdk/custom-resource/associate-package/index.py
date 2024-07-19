import boto3
import cfnresponse
import json

opensearch = boto3.client('opensearch')


def handler(event, context):
    print("Received event: " + json.dumps(event, indent=2))

    domain_name = event['ResourceProperties']['DomainName']

    if event['RequestType'] == 'Create':
        # OpenSearch 2.11 用の Sudachi Package ID を取得する（リージョンによって ID が変わる）
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

        cfnresponse.send(event, context, cfnresponse.SUCCESS, {}, package_id)
    if event['RequestType'] == 'Delete':
        opensearch.dissociate_package(
            DomainName=domain_name,
            PackageID=event['PhysicalResourceId']
        )

        cfnresponse.send(event, context, cfnresponse.SUCCESS, {})
    if event['RequestType'] == 'Update':
        cfnresponse.send(event, context, cfnresponse.SUCCESS, {})
