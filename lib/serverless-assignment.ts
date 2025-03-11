import * as cdk from "aws-cdk-lib";
import * as lambdanode from "aws-cdk-lib/aws-lambda-nodejs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as custom from "aws-cdk-lib/custom-resources";
import { Construct } from "constructs";
// import * as sqs from 'aws-cdk-lib/aws-sqs';
import { generateBatch } from "../shared/util";
import { reviews } from "../seed/reviews";
import * as apig from "aws-cdk-lib/aws-apigateway";

export class ServerlessAssignmentStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const reviewsTable = new dynamodb.Table(this, "ReviewsTable", {
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      partitionKey: { name: "movieId", type: dynamodb.AttributeType.NUMBER },
      sortKey: { name: "review_id", type: dynamodb.AttributeType.NUMBER },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      tableName: "Reviews",
    });

    // reviewsTable.addLocalSecondaryIndex({
    //   indexName: "review_dateIx",
    //   sortKey: { name: "review_date", type: dynamodb.AttributeType.STRING },
    // });

    
    // Functions 
    const getReviewByIdFn = new lambdanode.NodejsFunction(
      this,
      "GetReviewByIdFn",
      {
        architecture: lambda.Architecture.ARM_64,
        runtime: lambda.Runtime.NODEJS_18_X,
        entry: `${__dirname}/../lambdas/public/getReviewById.ts`,
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
          entry: `${__dirname}/../lambdas/public/getAllReviews.ts`,
          timeout: cdk.Duration.seconds(10),
          memorySize: 128,
          environment: {
            TABLE_NAME: reviewsTable.tableName,
            REGION: 'eu-west-1',
          },
        }
        );

   const newReviewFn = new lambdanode.NodejsFunction(this, "AddReviewsFn", {
    architecture: lambda.Architecture.ARM_64,
    runtime: lambda.Runtime.NODEJS_22_X,
    entry: `${__dirname}/../lambdas/private/addReviews.ts`,
    timeout: cdk.Duration.seconds(10),
    memorySize: 128,
    environment: {
      TABLE_NAME: reviewsTable.tableName,
      REGION: "eu-west-1",
    },
  });

      
        
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
        reviewsTable.grantReadWriteData(newReviewFn)
        
           // REST API 
    const api = new apig.RestApi(this, "RestAPI", {
      description: "assignment api",
      deployOptions: {
        stageName: "dev",
      },
      defaultCorsPreflightOptions: {
        allowHeaders: ["Content-Type", "X-Amz-Date"],
        allowMethods: ["OPTIONS", "GET", "POST", "PUT", "PATCH", "DELETE"],
        allowCredentials: true,
        allowOrigins: ["*"],
      },
    });

    // Reviews endpoint
    const moviesEndpoint = api.root.addResource("movies")
    const reviewsEndpoint = moviesEndpoint.addResource("reviews");
    const specificMovieEndpoint = reviewsEndpoint.addResource("{movieId}");

    reviewsEndpoint.addMethod(
      "GET",
      new apig.LambdaIntegration(getAllReviewsFn, { proxy: true })
    );

      reviewsEndpoint.addMethod(
        "POST",
        new apig.LambdaIntegration(newReviewFn, { proxy: true })
      );
  
    
    // Detail movie endpoint
    specificMovieEndpoint.addMethod(
      "GET",
      new apig.LambdaIntegration(getReviewByIdFn, { proxy: true })
    );

      }
    }
    