import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { fromCognitoIdentityPool } from '@aws-sdk/credential-providers';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { useEffect, useState } from 'react';
import useAuthToken from './useAuthToken';

export default function useS3Client() {
  const [s3Client, setS3Client] = useState<S3Client | undefined>(undefined);

  const tokens = useAuthToken();

  // Initialize and Set S3Client
  useEffect(() => {
    const region = import.meta.env.VITE_AWS_REGION;
    const userPoolId = import.meta.env.VITE_COGNITO_USER_POOL_ID;
    const identityPoolId = import.meta.env.VITE_COGNITO_IDENTITY_POOL_ID;
    const idToken = tokens?.idToken?.toString();

    if (idToken !== undefined) {
      const s3Client = new S3Client({
        region: region,
        credentials: fromCognitoIdentityPool({
          clientConfig: { region: region },
          identityPoolId: identityPoolId,
          logins: {
            [`cognito-idp.${region}.amazonaws.com/${userPoolId}`]: idToken,
          },
        }),
      });
      setS3Client(s3Client);
    }
  }, [tokens]);

  // Define method for generating signed url for browser preview
  const generateSignedUrl = async (bucketName: string, key: string) => {
    const command = new GetObjectCommand({ Bucket: bucketName, Key: key });
    if (s3Client === undefined) {
      return '';
    }

    try {
      const signedUrl = await getSignedUrl(s3Client, command);
      return signedUrl;
    } catch (err) {
      console.error(err);
      throw err;
    }
  };

  return {
    s3Client,
    generateSignedUrl,
  };
}
