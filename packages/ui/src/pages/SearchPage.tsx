import Loading from '@/components/Loading';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import useS3Client from '@/hooks/useS3Client';
import React, { useCallback, useEffect, useState } from 'react';
import {
  PostSearchResponseItem,
  SearchMethod,
  SearchResultUnit,
  getIndices,
  postSearch,
} from '../api';

export default function SearchPage() {
  const [loading, setLoading] = useState<boolean>(false);
  const [query, setQuery] = useState<string>('');
  const [searchMethod, setSearchMethod] = useState<SearchMethod>('hybrid');
  const [searchResultUnit, setSearchResultUnit] =
    useState<SearchResultUnit>('document');
  const [searchItems, setSearchItems] = useState<PostSearchResponseItem[]>([]);
  const queryRef = React.useRef<HTMLTextAreaElement>(null);

  const [signedUrls, setSignedUrls] = useState<string[]>([]);
  const { generateSignedUrl } = useS3Client();

  const [indices, setIndices] = useState<string[]>([]);
  const [currentIndex, setCurrentIndex] = useState<string>('');

  useEffect(() => {
    const fetchIndices = async () => {
      const data = await getIndices();
      setIndices(data.indices);
      if (data.indices.length > 0) {
        setCurrentIndex(data.indices[0]);
      }
    };
    fetchIndices();
  }, []);

  useEffect(() => {
    adjustTextareaHeight();
  }, [query]);

  const adjustTextareaHeight = () => {
    const textarea = queryRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${textarea.scrollHeight}px`;
    }
  };

  // Set Callback for SearchAPI and set document urls
  const search = useCallback(async () => {
    setLoading(true);
    const getS3Url = async (searchItem: PostSearchResponseItem) => {
      const docs_root = searchItem.docs_root;
      const doc_name = searchItem.doc_name;
      const bucketName = docs_root.replace('s3://', '').split('/')[0];
      return generateSignedUrl(bucketName, doc_name);
    };
    const items = await postSearch({
      indexName: currentIndex,
      text: query,
      searchMethod: searchMethod,
      searchResultUnit: searchResultUnit,
    });
    const urls = await Promise.all(items.map((item) => getS3Url(item)));
    setSignedUrls([...urls]);
    setSearchItems([...items]);
    setLoading(false);
  }, [currentIndex, query, searchMethod, searchResultUnit, generateSignedUrl]);

  // Call Search API on Enter key press
  useEffect(() => {
    const listener = (e: DocumentEventMap['keypress']) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        search();
      }
    };

    const elem = queryRef.current;
    elem?.addEventListener('keypress', listener);

    return () => {
      elem?.removeEventListener('keypress', listener);
    };
  }, [search]);

  const methods: SearchMethod[] = ['hybrid', 'keyword', 'vector'];
  const units: SearchResultUnit[] = ['document', 'chunk'];

  return (
    <>
      <div className="w-2/3 mx-auto py-10">
        <div className="flex flex-col space-y-4">
          <div className="flex">
            <div className="flex-grow flex-shrink-0 basis-1/6 mr-4">
              <p>Index Name: </p>
              <Select
                value={currentIndex}
                onValueChange={(value) => {
                  setCurrentIndex(value);
                }}>
                <SelectTrigger>
                  <SelectValue placeholder="Index Name" />
                </SelectTrigger>
                <SelectContent>
                  {indices.map((idx) => (
                    <SelectItem key={idx} value={idx}>
                      {idx}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex-grow flex-shrink-0 basis-1/6 mr-4">
              <p>Search Result Unit: </p>
              <Select
                value={searchResultUnit}
                onValueChange={(value) => {
                  setSearchResultUnit(value as SearchResultUnit);
                }}>
                <SelectTrigger>
                  <SelectValue placeholder={searchResultUnit} />
                </SelectTrigger>
                <SelectContent>
                  {units.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex-grow flex-shrink-0 basis-1/6">
              <p>Search Method: </p>
              <Select
                value={searchMethod}
                onValueChange={(value) => {
                  setSearchMethod(value as SearchMethod);
                }}>
                <SelectTrigger>
                  <SelectValue placeholder={searchMethod} />
                </SelectTrigger>
                <SelectContent>
                  {methods.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex">
            <div className="relative flex-grow flex-shrink-0 basis-3/6">
              <Textarea
                className="resize-none overflow-hidden"
                ref={queryRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Enter your query here: "
              />
            </div>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex flex-col items-center">
          <Loading />
        </div>
      ) : (
        <div className="w-2/3 mx-auto">
          {searchItems.map((item, index) => (
            <Card key={`${item.doc_name}-${index}`} className="my-5">
              <CardHeader>
                <CardTitle>
                  <Button variant={'link'} className="text-xl font-bold p-0">
                    <a
                      href={signedUrls[index]}
                      target="_blank"
                      rel="noreferrer noopener">
                      {item.doc_name}
                    </a>
                  </Button>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm">{item.text}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
