#!/bin/bash

set -eu

# デフォルト値
DEFAULT_STACK_NAME='OpensearchIntelligentSearchJpStack'
DEFAULT_INDEX_NAME='enterprise-search'
DEFAULT_EMBED_MODEL_ID='amazon.titan-embed-text-v2:0'

# オプションを解析
while [[ "$#" -gt 0 ]]; do
    case $1 in
        --index-name) INDEX_NAME="$2"; shift ;;
        --embed-model-id) EMBED_MODEL_ID="$2"; shift ;;
        *) echo "Unknown parameter passed: $1"; exit 1 ;;
    esac
    shift
done

# このスクリプト実行時にパラメータが指定されている場合は上書き
STACK_NAME="${STACK_NAME:-$DEFAULT_STACK_NAME}"
INDEX_NAME="${INDEX_NAME:-$DEFAULT_INDEX_NAME}"
EMBED_MODEL_ID="${EMBED_MODEL_ID:-$DEFAULT_EMBED_MODEL_ID}"

# CloudFormation のスタック出力から値を抽出する関数
function extract_value {
    echo $1 | jq -r ".Stacks[0].Outputs[] | select(.OutputKey | startswith(\"$2\"))  | .OutputValue"
}

# CloudFormation のスタック出力を取得
stack_output=`aws cloudformation describe-stacks --stack-name $STACK_NAME --output json`

# 必要なパラメータを抽出
ECS_CLUSTER_NAME=$(extract_value "$stack_output" 'IngestDataecsClusterName')
ECS_SECURITY_GROUP_ID=$(extract_value "$stack_output" 'IngestDataecsSecurityGroupID')
ECS_SUBNET_ID=$(extract_value "$stack_output" 'IngestDataecsSubnetID')
ECS_TASK_DEFINITION_ARN=$(extract_value "$stack_output" 'IngestDataecsTaskDefinitionARN')

# ECSタスクを実行
task_arn=$(aws ecs run-task --cluster $ECS_CLUSTER_NAME --task-definition $ECS_TASK_DEFINITION_ARN --launch-type FARGATE --network-configuration "awsvpcConfiguration={subnets=["$ECS_SUBNET_ID"],securityGroups=["$ECS_SECURITY_GROUP_ID"],assignPublicIp=ENABLED}" --overrides "{
    \"containerOverrides\": [{
        \"name\": \"Container\",
        \"environment\": [{
            \"name\": \"OPENSEARCH_INDEX_NAME\",
            \"value\": \"$INDEX_NAME\"
        },
        {
            \"name\": \"EMBED_MODEL_ID\",
            \"value\": \"$EMBED_MODEL_ID\"
        }
        ]
    }]
}" --query 'tasks[0].taskArn' --output text)
task_id=$(basename "$task_arn")
echo "Started ECS task with ID: $task_id"

# タスクのステータスをチェックする関数
function check_task_status {
    status=$(aws ecs describe-tasks --cluster $ECS_CLUSTER_NAME --tasks $task_id --query 'tasks[0].lastStatus' --output text)
    echo "Current status of task $task_id: $status"
}

# タスクが停止するまでステータスを監視
while true; do
    check_task_status
    if [ "$status" == "STOPPED" ]; then
        echo "Task $task_id has stopped."
        break
    fi
    sleep 30
done