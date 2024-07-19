import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Api } from './constructs/api';
import { Cognito } from './constructs/cognito';
import { Front } from './constructs/front';
import { IngestData } from './constructs/ingest-data-ecs';

import { Opensearch } from './constructs/opensearch';
import { S3bucket } from './constructs/s3bucket';
import { UtilLambda } from './constructs/util-lambda';

export class OpensearchIntelligentSearchJpStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const opensearchIndexName = this.node.tryGetContext('opensearchIndexName');
    const bedrockRegion = this.node.tryGetContext('bedrockRegion');
    const selfSignUpEnabled = this.node.tryGetContext('selfSignUpEnabled');

    const s3bucket = new S3bucket(this, 'S3bucket', {});
    const cognito = new Cognito(this, 'Cognito', {
      selfSignUpEnabled,
    });
    const opensearch = new Opensearch(this, 'OpenSearch', {
      userPoolId: cognito.userPool.userPoolId,
      identityPoolId: cognito.identityPool.ref,
      documentBucket: s3bucket.documentBucket,
    });
    const utilLambda = new UtilLambda(this, 'UtilLambda', {
      opensearchDomain: opensearch.opensearchDomain,
      opensearchIndexName: opensearchIndexName,
      bedrockRegion: bedrockRegion,
    });

    const api = new Api(this, 'Api', {
      userPool: cognito.userPool,
      opensearchDomain: opensearch.opensearchDomain,
      bedrockRegion: bedrockRegion,
    });

    const ingestData = new IngestData(this, 'IngestData', {
      documentBucket: s3bucket.documentBucket,
      opensearchDomain: opensearch.opensearchDomain,
      opensearchIndexName: opensearchIndexName,
      bedrockRegion: bedrockRegion,
    });

    const front = new Front(this, 'Front', {
      apiEndpointUrl: api.api.url,
      userPoolId: cognito.userPool.userPoolId,
      userPoolClientId: cognito.userPoolClient.userPoolClientId,
      identityPoolId: cognito.identityPool.ref,
    });
  }
}
