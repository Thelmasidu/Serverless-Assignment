import * as cdk from "aws-cdk-lib";
import * as lambdanode from "aws-cdk-lib/aws-lambda-nodejs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as custom from "aws-cdk-lib/custom-resources";
import { Construct } from "constructs";
// import * as sqs from 'aws-cdk-lib/aws-sqs';
import { generateBatch } from "../shared/util";
import { reviews } from "../seed/reviews";

export class ServerlessAssignmentStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Tables 
    /* const reviewsTable = new dynamodb.Table(this, "ReviewsTable", {
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      partitionKey: { name: "id", type: dynamodb.AttributeType.NUMBER },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      tableName: "Reviews",
    }); */

    const reviewsTable = new dynamodb.Table(this, "ReviewsTable", {
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      partitionKey: { name: "movieId", type: dynamodb.AttributeType.NUMBER },
      sortKey: { name: "rating", type: dynamodb.AttributeType.NUMBER },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      tableName: "Reviews",
    });

    reviewsTable.addLocalSecondaryIndex({
      indexName: "reviewer_nameIx",
      sortKey: { name: "reviewer_name", type: dynamodb.AttributeType.STRING },
    });

    reviewsTable.addLocalSecondaryIndex({
      indexName: "review_dateIx",
      sortKey: { name: "review_date", type: dynamodb.AttributeType.STRING },
    });

    
    // Functions 
    const getReviewByIdFn = new lambdanode.NodejsFunction(
      this,
      "GetReviewByIdFn",
      {
        architecture: lambda.Architecture.ARM_64,
        runtime: lambda.Runtime.NODEJS_18_X,
        entry: `${__dirname}/../lambdas/getReviewById.ts`,
        timeout: cdk.Duration.seconds(10),
        memorySize: 128,
        environment: {
          TABLE_NAME: reviewsTable.tableName,
          REGION: 'eu-west-1',
        },
      }
      );
      
      const getAllReviewsFn = new lambdanode.NodejsFunction(
        this,
        "GetAllReviewsFn",
        {
          architecture: lambda.Architecture.ARM_64,
          runtime: lambda.Runtime.NODEJS_18_X,
          entry: `${__dirname}/../lambdas/getAllReviews.ts`,
          timeout: cdk.Duration.seconds(10),
          memorySize: 128,
          environment: {
            TABLE_NAME: reviewsTable.tableName,
            REGION: 'eu-west-1',
          },
        }
        );
        
        new custom.AwsCustomResource(this, "reviewsddbInitData", {
          onCreate: {
            service: "DynamoDB",
            action: "batchWriteItem",
            parameters: {
              RequestItems: {
                [reviewsTable.tableName]: generateBatch(reviews),
              },
            },
            physicalResourceId: custom.PhysicalResourceId.of("reviewsddbInitData"), //.of(Date.now().toString()),
          },
          policy: custom.AwsCustomResourcePolicy.fromSdkCalls({
            resources: [reviewsTable.tableArn],
          }),
        });
        
        // Permissions 
        reviewsTable.grantReadData(getReviewByIdFn)
        reviewsTable.grantReadData(getAllReviewsFn)
        
        
      }
    }
    