import { fetchAuthSession } from 'aws-amplify/auth';
import axios, { AxiosRequestConfig } from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_ENDPOINT_URL,
});

api.interceptors.request.use(async (config) => {
  // If Authenticated, append ID Token to Request Header
  const { idToken } = (await fetchAuthSession()).tokens ?? {};
  if (idToken) {
    const token = idToken.toString();
    config.headers['Authorization'] = token;
  }
  config.headers['Content-Type'] = 'application/json';

  return config;
});

export type SearchMethod = 'hybrid' | 'keyword' | 'vector';
export type SearchResultUnit = 'document' | 'chunk';

export interface PostSearchRequest {
  indexName: string;
  text: string;
  searchMethod: SearchMethod;
  searchResultUnit: SearchResultUnit;
}

export interface PostSearchResponseItem {
  text: string;
  score: number;
  service: string;
  docs_root: string;
  doc_name: string;
}

export async function postSearch(
  request: PostSearchRequest,
  reqConfig?: AxiosRequestConfig
): Promise<PostSearchResponseItem[]> {
  try {
    const response = await api.post('/search', request, reqConfig);
    return response.data;
  } catch (err) {
    console.log(err);
    throw err;
  }
}

export interface getIndicesResponse {
  indices: string[];
}

export async function getIndices(): Promise<getIndicesResponse> {
  try {
    const response = await api.get('/index');
    return response.data;
  } catch (err) {
    console.log(err);
    throw err;
  }
}
