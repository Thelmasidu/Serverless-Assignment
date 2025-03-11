import { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";

const ddbDocClient = createDDbDocClient();

export const handler: APIGatewayProxyHandlerV2 = async (event, context) => {
  try {
    console.log("Event: ", JSON.stringify(event));
    const pathParams = event?.pathParameters;
    const queryParams = event?.queryStringParameters || {};
    
    const movieId = pathParams?.movieId ? parseInt(pathParams.movieId) : undefined;
    const reviewId = queryParams?.reviewId ? parseInt(queryParams.reviewId) : undefined;
    const reviewerEmail = queryParams?.reviewerName;

    if (!movieId) {
      return {
        statusCode: 404,
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ Message: "Missing movie Id" }),
      };
    }

    let commandOutput;
    
    // Base query for the movie ID
    const baseQuery = {
      TableName: process.env.TABLE_NAME,
      KeyConditionExpression: "movieId = :mid",
      ExpressionAttributeValues: {
        ":mid": movieId
      }
    };

    // If reviewId is provided, add it to the query
    if (reviewId) {
      baseQuery.KeyConditionExpression += " AND review_id = :rid";
      baseQuery.ExpressionAttributeValues[":rid"] = reviewId;
    }
    
    // First get items by primary/sort key
    commandOutput = await ddbDocClient.send(new QueryCommand(baseQuery));
    
    // If reviewer email is provided, filter the results
    if (reviewerEmail && commandOutput.Items && commandOutput.Items.length > 0) {
      commandOutput.Items = commandOutput.Items.filter(
        item => item.reviewer_id === reviewerEmail
      );
    }
    // If reviewerEmail but no results from the first query, try a scan with filter
    else if (reviewerEmail && (!commandOutput.Items || commandOutput.Items.length === 0)) {
      const scanOutput = await ddbDocClient.send(
        new ScanCommand({
          TableName: process.env.TABLE_NAME,
          FilterExpression: "movieId = :mid AND reviewer_id = :rev",
          ExpressionAttributeValues: {
            ":mid": movieId,
            ":rev": reviewerEmail
          }
        })
      );
      commandOutput = scanOutput;
    }

    if (!commandOutput.Items || commandOutput.Items.length === 0) {
      return {
        statusCode: 404,
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ Message: "No reviews found for this movie Id with the specified filters" }),
      };
    }

    const body = {
      data: commandOutput.Items,
    };

    // Return Response
    return {
      statusCode: 200,
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    };
  } catch (error: any) {
    console.log(JSON.stringify(error));
    return {
      statusCode: 500,
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ error }),
    };
  }
};

function createDDbDocClient() {
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