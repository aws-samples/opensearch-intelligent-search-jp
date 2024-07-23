import { PythonFunction } from '@aws-cdk/aws-lambda-python-alpha';
import { CustomResource, Duration, RemovalPolicy } from 'aws-cdk-lib';
import { CfnIdentityPoolRoleAttachment } from 'aws-cdk-lib/aws-cognito';
import { EbsDeviceVolumeType } from 'aws-cdk-lib/aws-ec2';
import {
  ManagedPolicy,
  PolicyStatement,
  Role,
  ServicePrincipal,
  WebIdentityPrincipal,
} from 'aws-cdk-lib/aws-iam';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { Domain, EngineVersion } from 'aws-cdk-lib/aws-opensearchservice';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import { Provider } from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';

export interface OpensearchProps {
  userPoolId: string;
  identityPoolId: string;
  documentBucket: Bucket;
}

export class Opensearch extends Construct {
  readonly opensearchDomain: Domain;
  constructor(scope: Construct, id: string, props: OpensearchProps) {
    super(scope, id);

    // Role to be assumed by OpenSearch Service for using Cognito as Auth Provider for OpenSerach Dashboards
    const cognitoConfigurationRole = new Role(
      this,
      'CognitoConfigurationRole',
      {
        assumedBy: new ServicePrincipal('opensearchservice.amazonaws.com'),
      }
    );
    cognitoConfigurationRole.addManagedPolicy(
      ManagedPolicy.fromAwsManagedPolicyName(
        'AmazonOpenSearchServiceCognitoAccess'
      )
    );

    // Role for Authenticated Identity in Cognito Identity Pool
    const cognitoAuthRole = new Role(this, 'CognitoAuthRole', {
      assumedBy: new WebIdentityPrincipal('cognito-identity.amazonaws.com', {
        StringEquals: {
          'cognito-identity.amazonaws.com:aud': props.identityPoolId,
        },
        'ForAnyValue:StringLike': {
          'cognito-identity.amazonaws.com:amr': 'authenticated',
        },
      }),
    });

    cognitoAuthRole.addToPolicy(
      new PolicyStatement({
        actions: ['s3:GetObject', 's3:ListBucket'],
        resources: [
          props.documentBucket.bucketArn,
          `${props.documentBucket.bucketArn}/*`,
        ],
      })
    );
    // cognitoAuthRole.addToPolicy(
    //   new PolicyStatement({
    //     actions: ['cognito-identity:GetCredentialsForIdentity'],
    //     resources: ['*'],
    //   })
    // );

    // Cognito Identity Pool Role Attachment
    new CfnIdentityPoolRoleAttachment(this, 'IdentityPoolRoleAttachment', {
      identityPoolId: props.identityPoolId,
      roles: {
        authenticated: cognitoAuthRole.roleArn,
      },
    });

    // OpenSearch Service Domain
    const domain = new Domain(this, 'Domain', {
      version: EngineVersion.OPENSEARCH_2_13,
      removalPolicy: RemovalPolicy.DESTROY,
      ebs: {
        volumeSize: 100,
        volumeType: EbsDeviceVolumeType.GP3,
      },
      nodeToNodeEncryption: true,
      encryptionAtRest: {
        enabled: true,
      },
      advancedOptions: { 'rest.action.multi.allow_explicit_index': 'true' },
      zoneAwareness: {
        enabled: false, // if enabled, nodes and replica index shards are placed in multi-AZ
      },
      capacity: {
        dataNodes: 1,
        dataNodeInstanceType: 'or1.large.search',
        multiAzWithStandbyEnabled: false,
      },
      cognitoDashboardsAuth: {
        role: cognitoConfigurationRole,
        identityPoolId: props.identityPoolId,
        userPoolId: props.userPoolId,
      },
    });

    // Allow Authenticated Role to es:ESHttp* for dashboard access
    domain.addAccessPolicies(
      new PolicyStatement({
        actions: ['es:ESHttp*'],
        principals: [cognitoAuthRole],
        resources: [domain.domainArn + '/*'],
      })
    );

    const associatePackageFunction = new PythonFunction(
      this,
      'AssociatePackageFunction',
      {
        entry: 'custom-resource/associate-package',
        runtime: Runtime.PYTHON_3_12,
        initialPolicy: [
          new PolicyStatement({
            actions: [
              'es:AssociatePackage',
              'es:DissociatePackage',
              'es:DescribePackages',
              'es:ListDomainsForPackage',
              'es:DescribeDomain',
            ],
            resources: ['*'],
          }),
        ],
        timeout: Duration.minutes(15),
      }
    );

    const provider = new Provider(this, 'ResourceProvider', {
      onEventHandler: associatePackageFunction,
    });

    new CustomResource(this, 'MyResource', {
      serviceToken: provider.serviceToken,
      properties: {
        DomainName: domain.domainName,
      },
    });

    this.opensearchDomain = domain;
  }
}
