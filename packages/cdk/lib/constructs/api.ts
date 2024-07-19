import { PythonFunction } from '@aws-cdk/aws-lambda-python-alpha';
import { Duration } from 'aws-cdk-lib';
import {
  AuthorizationType,
  CognitoUserPoolsAuthorizer,
  Cors,
  LambdaIntegration,
  MethodLoggingLevel,
  ResponseType,
  RestApi,
} from 'aws-cdk-lib/aws-apigateway';
import { UserPool } from 'aws-cdk-lib/aws-cognito';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { Domain } from 'aws-cdk-lib/aws-opensearchservice';
import { Construct } from 'constructs';

export interface ApiProps {
  userPool: UserPool;
  opensearchDomain: Domain;
  bedrockRegion: string;
}

export class Api extends Construct {
  public readonly api: RestApi;

  constructor(scope: Construct, id: string, props: ApiProps) {
    super(scope, id);

    // Lambda
    const searchDocuments = new PythonFunction(this, 'SearchDocuments', {
      entry: 'lambda/search-documents',
      runtime: Runtime.PYTHON_3_12,
      timeout: Duration.seconds(15),
      initialPolicy: [
        new PolicyStatement({
          actions: ['bedrock:InvokeModel'],
          resources: ['*'],
        }),
        new PolicyStatement({
          actions: ['es:ESHttpPost', 'es:ESHttpGet'],
          resources: [`${props.opensearchDomain.domainArn}/*`],
        }),
      ],
      environment: {
        OPENSEARCH_ENDPOINT: props.opensearchDomain.domainEndpoint,
        BEDROCK_REGION: props.bedrockRegion,
      },
    });

    const listIndex = new PythonFunction(this, 'ListIndex', {
      entry: 'lambda/list-index',
      runtime: Runtime.PYTHON_3_12,
      timeout: Duration.seconds(15),
      initialPolicy: [
        new PolicyStatement({
          actions: ['es:ESHttpPost', 'es:ESHttpGet'],
          resources: [`${props.opensearchDomain.domainArn}/*`],
        }),
      ],
      environment: {
        OPENSEARCH_ENDPOINT: props.opensearchDomain.domainEndpoint,
      },
    });

    // Cognito Authorizer for API Gateway
    const authorizer = new CognitoUserPoolsAuthorizer(
      this,
      'CognitoAuthorizer',
      {
        cognitoUserPools: [props.userPool],
      }
    );

    // Api Gateway
    const api = new RestApi(this, 'RestApi', {
      defaultCorsPreflightOptions: {
        allowOrigins: Cors.ALL_ORIGINS,
        allowMethods: Cors.ALL_METHODS,
      },
      cloudWatchRole: true,
      deployOptions: {
        dataTraceEnabled: true,
        loggingLevel: MethodLoggingLevel.INFO,
      },
      defaultMethodOptions: { authorizationType: AuthorizationType.IAM },
    });
    api.addGatewayResponse('Api4XX', {
      type: ResponseType.DEFAULT_4XX,
      responseHeaders: {
        'Access-Control-Allow-Origin': "'*'",
      },
    });

    api.addGatewayResponse('Api5XX', {
      type: ResponseType.DEFAULT_5XX,
      responseHeaders: {
        'Access-Control-Allow-Origin': "'*'",
      },
    });
    const searchResource = api.root.addResource('search');
    searchResource.addMethod('POST', new LambdaIntegration(searchDocuments), {
      authorizer,
      authorizationType: AuthorizationType.COGNITO,
    });
    const indexResource = api.root.addResource('index');
    indexResource.addMethod('GET', new LambdaIntegration(listIndex), {
      authorizer,
      authorizationType: AuthorizationType.COGNITO,
    });

    this.api = api;
  }
}
