import { PythonFunction } from '@aws-cdk/aws-lambda-python-alpha';
import { CfnOutput, Duration } from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Domain } from 'aws-cdk-lib/aws-opensearchservice';

import { Construct } from 'constructs';

export interface UtilLambdaProps {
  opensearchDomain: Domain;
  opensearchIndexName: string;
  bedrockRegion: string;
}

export class UtilLambda extends Construct {
  constructor(scope: Construct, id: string, props: UtilLambdaProps) {
    super(scope, id);

    const deleteIndexLambdaRole = new iam.Role(this, `deleteIndexLambdaRole`, {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    });
    deleteIndexLambdaRole.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          'logs:CreateLogGroup',
          'logs:CreateLogStream',
          'logs:PutLogEvents',
        ],
        resources: ['arn:aws:logs:*:*:*'],
      })
    );

    deleteIndexLambdaRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['es:ESHttpDelete'],
        resources: [`${props.opensearchDomain.domainArn}/*`],
      })
    );

    const deleteIndexFunction = new PythonFunction(this, `DeleteIndex`, {
      runtime: lambda.Runtime.PYTHON_3_12,
      entry: 'lambda/delete-opensearch-index/',
      timeout: Duration.seconds(60 * 5),
      retryAttempts: 1,
      role: deleteIndexLambdaRole,
      environment: {
        OPENSEARCH_ENDPOINT: props.opensearchDomain.domainEndpoint,
        INDEX_NAME: props.opensearchIndexName,
      },
    });

    new CfnOutput(this, 'deleteIndexFunctionName', {
      value: deleteIndexFunction.functionName,
      description: 'Delete Index lambda function name',
      exportName: `DeleteIndexFunction`,
    });
  }
}
