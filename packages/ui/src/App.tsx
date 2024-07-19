import { Authenticator, useAuthenticator } from '@aws-amplify/ui-react';
import './App.css';
import { Button } from './components/ui/button';
import SearchPage from './pages/SearchPage';

function App() {
  const { signOut, authStatus } = useAuthenticator((context) => [context.user]);

  return (
    <>
      <div className="screen:w-screen screen:h-screen overflow-x-hidden">
        <main className="flex-1">
          {/* Header */}
          {/* <header className="bg-aws-squid-ink flex h-12 w-full items-center justify-between text-lg text-white print:hidden">
            <div className="text-center w-full">
              OpenSearch ハイブリッド検索 Demo
            </div>
          </header> */}

          {/* Main contents */}
          <div className="text-aws-font-color" id="main">
            {authStatus !== 'authenticated' ? (
              <Authenticator />
            ) : (
              <>
                <div className="absolute right-8">
                  <Button onClick={signOut} variant={'link'}>
                    Sign Out
                  </Button>
                </div>
                <SearchPage />
              </>
            )}
          </div>
        </main>
      </div>
    </>
  );
}

export default App;
