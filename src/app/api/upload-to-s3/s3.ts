// /lib/s3.ts
import AWS from "aws-sdk";

// S3 client: automatically picks up credentials from environment, CLI, or IAM role
const s3 = new AWS.S3({
  region: process.env.AWS_REGION, // e.g., "us-west-1"
});

export async function uploadFileToS3(
  bucketName: string,
  key: string,
  file: Buffer | Blob | string
): Promise<boolean> {
  console.log("uploadFileToS3", bucketName, key, file);

  try {
    let body: Buffer | string = file as Buffer | string;

    // Convert Blob to Buffer if running in Node.js
    if (typeof Blob !== "undefined" && file instanceof Blob) {
      body = Buffer.from(await file.arrayBuffer());
    }

    // Upload to S3
    await s3
      .upload({
        Bucket: bucketName,
        Key: key,
        Body: body,
        ACL: "private", // optional
      })
      .promise();

    console.log(`✅ File uploaded: s3://${bucketName}/${key}`);
    return true;
  } catch (error) {
    console.error("❌ S3 upload failed:", error);
    throw new Error("upload to s3 failed");
  }
}

export async function getFileFromS3(bucketName: string, key: string) {
  try {
    const result = await s3
      .getObject({
        Bucket: bucketName,
        Key: key,
      })
      .promise();

    return result.Body; // Buffer or readable stream
  } catch (error) {
    console.error("❌ S3 get file failed:", error);
    throw error;
  }
}
