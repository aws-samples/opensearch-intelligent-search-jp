import { AuthTokens, fetchAuthSession } from 'aws-amplify/auth';
import { useEffect, useState } from 'react';

export default function useAuthToken() {
  const [tokens, setTokens] = useState<AuthTokens | undefined>(undefined);

  useEffect(() => {
    async function getToken() {
      try {
        const tokens = (await fetchAuthSession()).tokens;
        setTokens(tokens);
      } catch (err) {
        console.log(err);
      }
    }

    getToken();
  }, [tokens]);

  return tokens;
}
