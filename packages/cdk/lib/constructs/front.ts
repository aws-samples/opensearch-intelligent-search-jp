import {
  CloudFrontToS3,
  CloudFrontToS3Props,
} from '@aws-solutions-constructs/aws-cloudfront-s3';
import { Aws, CfnOutput, RemovalPolicy, StackProps } from 'aws-cdk-lib';
import {
  BlockPublicAccess,
  BucketEncryption,
  BucketProps,
  ObjectOwnership,
} from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import { NodejsBuild } from 'deploy-time-build';

export interface FrontProps extends StackProps {
  apiEndpointUrl: string;
  userPoolId: string;
  userPoolClientId: string;
  identityPoolId: string;
}

export class Front extends Construct {
  constructor(scope: Construct, id: string, props: FrontProps) {
    super(scope, id);

    // CloudFront - S3
    const commonBucketProps: BucketProps = {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.S3_MANAGED,
      autoDeleteObjects: true,
      removalPolicy: RemovalPolicy.DESTROY,
      objectOwnership: ObjectOwnership.OBJECT_WRITER,
      enforceSSL: true,
    };

    const cloudFrontToS3Props: CloudFrontToS3Props = {
      insertHttpSecurityHeaders: false,
      loggingBucketProps: commonBucketProps,
      bucketProps: commonBucketProps,
      cloudFrontLoggingBucketProps: commonBucketProps,
      cloudFrontDistributionProps: {
        errorResponses: [
          {
            httpStatus: 403,
            responseHttpStatus: 200,
            responsePagePath: '/index.html',
          },
          {
            httpStatus: 404,
            responseHttpStatus: 200,
            responsePagePath: '/index.html',
          },
        ],
      },
    };

    const { cloudFrontWebDistribution, s3BucketInterface } = new CloudFrontToS3(
      this,
      'CloudFrontToS3',
      cloudFrontToS3Props
    );

    // Build frontend
    new NodejsBuild(this, 'FrontBuild', {
      assets: [
        {
          path: '../../',
          exclude: [
            '.git',
            '.github',
            '.gitignore',
            '*.md',
            'node_modules',
            'packages/cdk/**/*',
            '!packages/cdk/cdk.json',
            'packages/ui/dist',
            'packages/ui/node_modules',
            'packages/ui/dev-dist',
          ],
        },
      ],
      destinationBucket: s3BucketInterface,
      distribution: cloudFrontWebDistribution,
      outputSourceDirectory: './packages/ui/dist',
      buildCommands: ['npm ci', 'npm -w packages/ui run build'],
      buildEnvironment: {
        VITE_AWS_REGION: Aws.REGION,
        VITE_API_ENDPOINT_URL: props.apiEndpointUrl,
        VITE_COGNITO_USER_POOL_ID: props.userPoolId,
        VITE_COGNITO_USER_POOL_CLIENT_ID: props.userPoolClientId,
        VITE_COGNITO_IDENTITY_POOL_ID: props.identityPoolId,
      },
    });

    new CfnOutput(this, 'FrontendUrl', {
      value: `https://${cloudFrontWebDistribution.distributionDomainName}`,
      description: 'Frontend URL',
      exportName: `FrontendUrl`,
    });
  }
}
