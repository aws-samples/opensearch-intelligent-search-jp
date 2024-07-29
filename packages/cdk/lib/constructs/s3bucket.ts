import { CfnOutput, RemovalPolicy } from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

export interface S3bucketsProps {}

export class S3bucket extends Construct {
  readonly documentBucket: s3.Bucket;
  constructor(scope: Construct, id: string, props: S3bucketsProps) {
    super(scope, id);

    const documentBucket = new s3.Bucket(this, `documentBucket`, {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });
    this.documentBucket = documentBucket;

    new CfnOutput(this, 'documentBucketName', {
      value: documentBucket.bucketName,
      description: 'Document bucket name',
      exportName: `DocumentBucketName`,
    });
  }
}
