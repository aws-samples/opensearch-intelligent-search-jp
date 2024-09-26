import { CfnOutput, RemovalPolicy } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { IVpc, Vpc } from 'aws-cdk-lib/aws-ec2';
import { Platform } from 'aws-cdk-lib/aws-ecr-assets';
import {
  Cluster,
  ContainerImage,
  CpuArchitecture,
  FargateTaskDefinition,
  LogDriver,
  OperatingSystemFamily,
} from 'aws-cdk-lib/aws-ecs';
import { Effect, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { LogGroup } from 'aws-cdk-lib/aws-logs';
import { Domain } from 'aws-cdk-lib/aws-opensearchservice';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import { Construct } from 'constructs';
import { ServiceLinkedRole } from 'upsert-slr';

export interface IngestDataProps {
  documentBucket: Bucket;
  vpcId?: string;
  opensearchDomain: Domain;
  bedrockRegion: string;
}

export class IngestData extends Construct {
  constructor(scope: Construct, id: string, props: IngestDataProps) {
    super(scope, id);

    const s3d = new s3deploy.BucketDeployment(this, `DeployDocuments`, {
      sources: [s3deploy.Source.asset('../../docs.zip')],
      destinationBucket: props.documentBucket,
      contentType: 'text/plain; charset=utf-8',
    });

    // VPC
    let vpc: IVpc;
    if (props.vpcId) {
      vpc = Vpc.fromLookup(this, 'Vpc', { vpcId: props.vpcId });
    } else {
      vpc = new Vpc(this, 'Vpc', {
        maxAzs: 2,
      });
    }
    // ECS
    const cluster = new Cluster(this, 'Cluster', {
      vpc: vpc,
      containerInsights: true,
    });

    new ServiceLinkedRole(this, 'EcsServiceLinkedRole', {
      awsServiceName: 'ecs.amazonaws.com',
    });

    const taskDefinition = new FargateTaskDefinition(this, 'TaskDefinition', {
      cpu: 2048,
      memoryLimitMiB: 4096,
      runtimePlatform: {
        cpuArchitecture: CpuArchitecture.X86_64,
        operatingSystemFamily: OperatingSystemFamily.LINUX,
      },
    });

    taskDefinition.addToTaskRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['s3:GetObject'],
        resources: [props.documentBucket.arnForObjects('*')],
      })
    );

    taskDefinition.addToTaskRolePolicy(
      new PolicyStatement({
        actions: ['bedrock:InvokeModel'],
        resources: ['*'],
      })
    );
    taskDefinition.addToTaskRolePolicy(
      new PolicyStatement({
        actions: ['es:ESHttpPost', 'es:ESHttpPut'],
        resources: [`${props.opensearchDomain.domainArn}/*`],
      })
    );

    const taskSg = new ec2.SecurityGroup(this, 'TaskSecurityGroup', {
      vpc: vpc,
      allowAllOutbound: true,
    });

    props.opensearchDomain.grantIndexReadWrite('*', taskDefinition.taskRole);
    props.documentBucket.grantReadWrite(taskDefinition.taskRole);

    const taskLogGroup = new LogGroup(this, 'TaskLogGroup', {
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const container = taskDefinition.addContainer('Container', {
      image: ContainerImage.fromAsset('ecs/ingest-data', {
        platform: Platform.LINUX_AMD64,
      }),
      logging: LogDriver.awsLogs({
        streamPrefix: 'ingest-data',
        logGroup: taskLogGroup,
      }),
      environment: {
        OPENSEARCH_ENDPOINT: props.opensearchDomain.domainEndpoint,
        OPENSEARCH_INDEX_NAME: '',
        BEDROCK_REGION: props.bedrockRegion,
        EMBED_DIMENSION: '1024',
        EMBED_MODEL_ID: '',
        DOCUMENT_S3_URI: `s3://${props.documentBucket.bucketName}/docs`,
      },
    });

    taskLogGroup.grantWrite(container.taskDefinition.executionRole!);

    new CfnOutput(this, 'ecsClusterName', {
      value: cluster.clusterName,
      description: 'ECS cluster name',
      exportName: `EcsClusterName`,
    });

    new CfnOutput(this, 'ecsTaskDefinitionARN', {
      value: taskDefinition.taskDefinitionArn,
      description: 'ECS task definition ARN',
      exportName: `EcsTaskDefinitionARN`,
    });

    new CfnOutput(this, 'ecsSubnetID', {
      value: vpc.privateSubnets[0].subnetId,
      description: 'Subnet ID for ECS cluster',
      exportName: `EcsSubnetID`,
    });

    new CfnOutput(this, 'ecsSecurityGroupID', {
      value: taskSg.securityGroupId,
      description: 'Security group ID for ECS task',
      exportName: `EcsSecurityGroupID`,
    });
  }
}
