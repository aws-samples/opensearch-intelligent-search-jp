import boto3
import tempfile
import os

# from unstructured.partition.auto import partition
from langchain_community.document_loaders import (
    Docx2txtLoader,
    TextLoader,
    UnstructuredHTMLLoader,
    UnstructuredPowerPointLoader,
    PyPDFLoader,
)

s3_client = boto3.client("s3")


def parse_s3_uri(s3_uri):
    """
    S3のURIをバケット名、キー名、拡張子に分割する
    
    Args:
        s3_uri (str): 例's3://bucket_name/test/test.txt'
    Returns:
        bucket: バケット名(bucket_name)
        key: キー名(test/test.txt)
        extension: 拡張子(.txt)
    """
    bucket = s3_uri.split("//")[1].split("/")[0]
    key = '/'.join(s3_uri.split("//")[1].split("/")[1:])
    extension = os.path.splitext(key)[-1]

    return bucket, key, extension


def read_file(file_url):
    bucket, key, extension = parse_s3_uri(file_url)

    text = ""

    with tempfile.NamedTemporaryFile(
        delete=True, suffix=extension
    ) as temp_file:
        temp_file_path = temp_file.name
        s3_client.download_file(bucket, key, temp_file_path)

        print(f"Load file: {os.path.basename(key)}")

        if extension == ".txt":
            text = load_text(temp_file_path)
        if extension == ".pdf":
            text = load_pdf(temp_file_path)
            text = (
                text.replace("\n", "").replace("\r", "").replace("\u00A0", " ")
            )
        if extension == ".docx":
            text = load_word(temp_file_path)
        if extension == ".pptx":
            text = load_ppt(temp_file_path)
        if extension == ".html":
            text = load_html(temp_file_path)
            text = (
                text.replace("\n", "").replace("\r", "").replace("\u00A0", " ")
            )

    return text


def load_text(file_path):
    try:
        loader = TextLoader(str(file_path))
    except Exception as e:
        print(e)
    pages = loader.load_and_split()
    text = ""
    for page in pages:
        text += page.page_content
    return text


def load_pdf(file_path):
    try:
        loader = PyPDFLoader(str(file_path))
    except Exception as e:
        print(e)

    pages = loader.load_and_split()
    text = ""
    for page in pages:
        try:
            text += bytes(page.page_content, "latin1").decode("shift_jis")
        except UnicodeEncodeError:
            text += page.page_content
        except UnicodeDecodeError:
            text += "Unicode Decode Error"

    return text


def load_word(file_path):
    try:
        loader = Docx2txtLoader(str(file_path))
    except Exception as e:
        print(e)
    pages = loader.load_and_split()
    text = ""
    for page in pages:
        text += page.page_content
    return text


def load_ppt(file_path):
    try:
        loader = UnstructuredPowerPointLoader(str(file_path))
    except Exception as e:
        print(e)
    pages = loader.load_and_split()
    text = ""
    for page in pages:
        text += page.page_content
    return text


def load_html(file_path):
    try:
        loader = UnstructuredHTMLLoader(str(file_path))
    except Exception as e:
        print(e)
    pages = loader.load_and_split()
    text = ""

    for page in pages:
        text += page.page_content
    return text


def get_all_filepath(file_url):
    bucket_name = file_url.split("/")[2]
    prefix = "/".join(file_url.split("/")[3:])

    file_list = []
    objects = s3_client.list_objects_v2(Bucket=bucket_name, Prefix=prefix)
    if "Contents" in objects:
        file_list.extend(
            (
                [
                    f's3://{bucket_name}/{content["Key"]}'
                    for content in objects["Contents"]
                ]
            )
        )
        while objects.get("isTruncated"):
            start_after = file_list[-1]
            objects = s3_client.list_objects_v2(
                Bucket=bucket_name, Prefix=prefix, StartAfter=start_after
            )
            if "Contents" in objects:
                file_list.extend(
                    ([content["Key"] for content in objects["Contents"]])
                )

    return file_list


def get_all_keys(file_url):
    bucket_name = file_url.split("/")[2]
    prefix = "/".join(file_url.split("/")[3:])

    file_list = []
    objects = s3_client.list_objects_v2(Bucket=bucket_name, Prefix=prefix)
    if "Contents" in objects:
        file_list.extend(([content["Key"] for content in objects["Contents"]]))
        while objects.get("isTruncated"):
            start_after = file_list[-1]
            objects = s3_client.list_objects_v2(
                Bucket=bucket_name, Prefix=prefix, StartAfter=start_after
            )
            if "Contents" in objects:
                file_list.extend(
                    ([content["Key"] for content in objects["Contents"]])
                )

    return file_list


def get_documents(file_url, dst_path):

    bucket_name = file_url.split("/")[2]
    file_list = get_all_keys(file_url)

    for s3_key in file_list:
        dst_dir = f"{dst_path}/{s3_key}"
        if not os.path.exists(os.path.dirname(dst_dir)):
            os.makedirs(os.path.dirname(dst_dir))
        s3_client.download_file(bucket_name, s3_key, f"{dst_path}/{s3_key}")
