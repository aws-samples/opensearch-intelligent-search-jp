import { Aws, RemovalPolicy } from 'aws-cdk-lib';
import {
  CfnIdentityPool,
  UserPool,
  UserPoolClient,
} from 'aws-cdk-lib/aws-cognito';
import { Construct } from 'constructs';

export interface CognitoProps {
  selfSignUpEnabled: boolean;
}

export class Cognito extends Construct {
  readonly userPool: UserPool;
  readonly userPoolClient: UserPoolClient;
  readonly identityPool: CfnIdentityPool;

  constructor(scope: Construct, id: string, props: CognitoProps) {
    super(scope, id);

    // Cognito UserPool
    const userPool = new UserPool(this, 'UserPool', {
      // SignUp
      selfSignUpEnabled: props.selfSignUpEnabled,
      userInvitation: {
        emailSubject: 'GenerativeAI Japanese Search Sample User Registration',
        emailBody: 'Hello {username}, Your temporary password is {####}',
        smsMessage: 'Hello {username}, Your temporary password is {####}',
      },
      // SignIn
      signInAliases: {
        email: true,
      },
      signInCaseSensitive: false, // Recommended to be incasesensitive
      removalPolicy: RemovalPolicy.DESTROY,
      deletionProtection: false,
    });

    // Cognito UserPool AppClient for web frontend ui
    const appClient = userPool.addClient('Client');

    // Cognito Domain
    userPool.addDomain('CognitoDomain', {
      cognitoDomain: {
        domainPrefix: `generative-ai-japanese-search-${Aws.ACCOUNT_ID}`, // must be unique globally
      },
    });

    // Cognito IdentityPool
    const identityPool = new CfnIdentityPool(this, 'IdentityPool', {
      allowUnauthenticatedIdentities: false,
      cognitoIdentityProviders: [
        {
          clientId: appClient.userPoolClientId,
          providerName: userPool.userPoolProviderName,
        },
      ],
    });

    this.userPool = userPool;
    this.userPoolClient = appClient;
    this.identityPool = identityPool;
  }
}
