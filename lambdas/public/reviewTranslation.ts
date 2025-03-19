import { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  QueryCommand,
  QueryCommandInput,
} from "@aws-sdk/lib-dynamodb";
import {
  TranslateClient,
  TranslateTextCommand,
} from "@aws-sdk/client-translate";
import Ajv from "ajv";
import schema from "../../shared/types.schema.json";

const ajv = new Ajv();
const isValidQueryParams = ajv.compile(
  schema.definitions["LanguageQueryParams"] || {}
);

const headers = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "OPTIONS,GET,POST,PUT",
  "Access-Control-Allow-Headers":
    "Content-Type, Accept, X-Requested-With, Authorization",
};

const ddbDocClient = createDocumentClient();

export const handler: APIGatewayProxyHandlerV2 = async (event, context) => {
  try {
    console.log("Event: ", event);
    const pathParams = event?.pathParameters;
    const queryParams = event?.queryStringParameters || {};
    
    if (
      !pathParams ||
      !pathParams.reviewId ||
      !pathParams.movieId ||
      !queryParams.language
    ) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ message: "Missing required parameters" }),
      };
    }
    
    if (!isValidQueryParams(queryParams)) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          message: `Incorrect type. Must match Query parameters schema`,
          schema: schema.definitions["LanguageQueryParams"],
        }),
      };
    }
    
    const movieId = parseInt(pathParams.movieId);
    const reviewId = parseInt(pathParams.reviewId);
    const language = queryParams.language;
    
    const commandInput: QueryCommandInput = {
      TableName: process.env.TABLE_NAME,
      KeyConditionExpression: "movieId = :m and review_id = :r",
      ExpressionAttributeValues: {
        ":m": movieId,
        ":r": reviewId,
      },
    };
    
    const commandOutput = await ddbDocClient.send(
      new QueryCommand(commandInput)
    );
    
    if (!commandOutput.Items || commandOutput.Items.length === 0) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ message: "Review not found" }),
      };
    }
    
    const content = commandOutput.Items[0].content;
    
    const translate = {
      Text: content,
      SourceLanguageCode: "en",
      TargetLanguageCode: language,
    };
    
    const translateClient = new TranslateClient({ region: process.env.REGION });
    const translatedText = await translateClient.send(
      new TranslateTextCommand(translate)
    );
    
    const translatedData = translatedText.TranslatedText;
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        data: {
          original: content,
          translated: translatedData,
          language: language
        },
      }),
    };
  } catch (error: any) {
    console.log(JSON.stringify(error));
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error }),
    };
  }
};

function createDocumentClient() {
  const ddbClient = new DynamoDBClient({ region: process.env.REGION });
  const marshallOptions = {
    convertEmptyValues: true,
    removeUndefinedValues: true,
    convertClassInstanceToMap: true,
  };
  const unmarshallOptions = {
    wrapNumbers: false,
  };
  const translateConfig = { marshallOptions, unmarshallOptions };
  return DynamoDBDocumentClient.from(ddbClient, translateConfig);
}
