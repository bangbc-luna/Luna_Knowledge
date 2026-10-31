set -eu

: "${MINIO_ROOT_USER:?}" "${MINIO_ROOT_PASSWORD:?}" "${S3_ACCESS_KEY:?}" "${S3_SECRET_KEY:?}"

if [ "$S3_ACCESS_KEY" = "$MINIO_ROOT_USER" ]; then
  echo 'S3_ACCESS_KEY must differ from MINIO_ROOT_USER' >&2
  exit 1
fi

resources=''
for bucket in "$S3_BUCKET_TMP" "$S3_BUCKET_HLS" "$S3_BUCKET_PREVIEWS" "$S3_BUCKET_THUMBNAILS" "$S3_BUCKET_ASSETS" "$S3_BUCKET_ORIGINALS"; do
  resources="${resources:+$resources,}\"arn:aws:s3:::$bucket\",\"arn:aws:s3:::$bucket/*\""
done

policy=/tmp/luna-app-policy.json
cat > "$policy" <<JSON
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject",
        "s3:AbortMultipartUpload",
        "s3:ListMultipartUploadParts",
        "s3:ListBucket",
        "s3:ListBucketMultipartUploads",
        "s3:GetBucketLocation"
      ],
      "Resource": [$resources]
    }
  ]
}
JSON

export MC_CONFIG_DIR=/tmp/mc
mc alias set local http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null
mc admin user add local "$S3_ACCESS_KEY" "$S3_SECRET_KEY"
mc admin policy create local luna-app "$policy"
mc admin policy attach local luna-app --user "$S3_ACCESS_KEY" || mc admin user info local "$S3_ACCESS_KEY" | grep -q 'luna-app'
echo "MinIO user $S3_ACCESS_KEY ready with policy luna-app"
