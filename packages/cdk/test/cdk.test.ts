import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { OpensearchIntelligentSearchJpStack } from '../lib/opensearch-intelligent-search-jp-stack';

test('Snapshot Test', () => {
  const app = new App();
  const stack = new OpensearchIntelligentSearchJpStack(
    app,
    'OpensearchIntelligentSearchJpStack'
  );
  const template = Template.fromStack(stack);
  expect(template).toMatchSnapshot();
});
