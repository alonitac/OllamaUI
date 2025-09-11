import { createOllama } from 'ollama-ai-provider';
import { streamText, convertToCoreMessages, CoreMessage, UserContent } from 'ai';
//export const runtime = "edge";
export const dynamic = "force-dynamic";
import {uploadFileToS3} from "../upload-to-s3/s3";
import { th } from 'zod/v4/locales';
export async function POST(req: Request) {
  
  // Destructure request data
  const { messages, data,id} = await req.json();
  
  // Remove experimental_attachments from each message
  const cleanedMessages = messages.map((message: any) => {
    const { experimental_attachments, ...cleanMessage } = message;
    return cleanMessage;
  });

  let message = 'Please provide an image for object detection.';
 
  // Check if there are images for object detection
  if (data?.images && data.images.length > 0) {
    try {
      // Handle object detection for the first image
      const imageUrl = data.images[0];
      
      // Convert data URL to blob for upload
      const response = await fetch(imageUrl);
      const blob = await response.blob();
      
      // Create FormData for the prediction API
      // const formData = new FormData();
      const timestamp = Date.now();
      const imgKey = `image${timestamp}.jpg`;     //TODO add a call for storing the image in s3 or put the code in the component add a timestamp for the photo we store in s3
      
      //formData.append('file', blob, imgKey);
      // Call the object detection API
     
      const bucketName = process.env.S3_BUCKET!;
      const upload_to_s =await uploadFileToS3(bucketName,imgKey,blob)
      if(!upload_to_s){
        throw new Error("upload to s3 failed");
      }
   
      const predictionResponse = await fetch(`http://${process.env.YOLO_SERVICE}/predict?chat_id=${encodeURIComponent(id)}&img=${encodeURIComponent(imgKey)}`, {
        method: 'POST',
       // body: formData,//need to remove this and make a call before the fetch to store the image s3 
        
      });
      
      if (!predictionResponse.ok) {
        throw new Error(`Prediction API error: ${predictionResponse.status}`);
      }
      
      const predictionResult = await predictionResponse.json();
      
      // Format the detection results for chat
      message = `🔍 **Object Detection Results**

**Detection Count:** ${predictionResult.detection_count}
**Detected Objects:** ${predictionResult.labels.join(', ')}
**Prediction ID:** ${predictionResult.prediction_uid}
I've analyzed your image and detected ${predictionResult.detection_count} object(s). The detected objects include: ${predictionResult.labels.join(', ')}.`;
    
    } catch (error) {
      console.log(process.env.YOLO_SERVICE);
      message = `❌ **Object Detection Error**

Sorry, I encountered an error while processing your image: ${error instanceof Error ? error.message : 'Unknown error'}

Please make sure the object detection service is running on localhost:8080.`;
     }
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      // Split message into lines and send each line as a separate chunk
      const lines = message.split('\n');
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Add newline character back except for the last line
        const content = i < lines.length - 1 ? line + '\n' : line;
        controller.enqueue(encoder.encode(`0:${JSON.stringify(content)}\n`));
      }
      
      // Send finish event
      controller.enqueue(encoder.encode(`e:${JSON.stringify({
        finishReason: "stop",
        usage: { promptTokens: 10, completionTokens: message.length },
        isContinued: false
      })}\n`));
      
      // Send done event
      controller.enqueue(encoder.encode(`d:${JSON.stringify({
        finishReason: "stop",
        usage: { promptTokens: 10, completionTokens: message.length }
      })}\n`));
      
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Vercel-AI-Data-Stream': 'v1',
    },
  });
}
