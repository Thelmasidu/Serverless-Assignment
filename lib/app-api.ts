import * as cdk from "aws-cdk-lib";
import * as lambdanode from "aws-cdk-lib/aws-lambda-nodejs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as custom from "aws-cdk-lib/custom-resources";
import { Construct } from "constructs";
import { generateBatch } from "../shared/util";
import { reviews } from "../seed/reviews";
import * as apig from "aws-cdk-lib/aws-apigateway";
import * as node from "aws-cdk-lib/aws-lambda-nodejs";
import * as iam from "aws-cdk-lib/aws-iam";

type AppApiProps = {
  userPoolId: string;
  userPoolClientId: string;
};

export class AppApi extends Construct {
  constructor(scope: Construct, id: string, props: AppApiProps) {
    super(scope, id);

    const reviewsTable = new dynamodb.Table(this, "ReviewsTable", {
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      partitionKey: { name: "movieId", type: dynamodb.AttributeType.NUMBER },
      sortKey: { name: "review_id", type: dynamodb.AttributeType.NUMBER },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      tableName: "Reviews",
    });

    const appCommonFnProps = {
      architecture: lambda.Architecture.ARM_64,
      timeout: cdk.Duration.seconds(10),
      memorySize: 128,
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: "handler",
      environment: {
        USER_POOL_ID: props.userPoolId,
        CLIENT_ID: props.userPoolClientId,
        REGION: cdk.Aws.REGION,
        TABLE_NAME: reviewsTable.tableName,
      },
    };

    // Functions
    const getReviewByIdFn = new lambdanode.NodejsFunction(this, "GetReviewByIdFn", {
      ...appCommonFnProps,
      entry: `${__dirname}/../lambdas/public/getReviewById.ts`,
    });

    const getAllReviewsFn = new lambdanode.NodejsFunction(this, "GetAllReviewsFn", {
      ...appCommonFnProps,
      entry: `${__dirname}/../lambdas/public/getAllReviews.ts`,
    });

    const translateReviewFn = new lambdanode.NodejsFunction(this, "TranslateReviewFn", {
      ...appCommonFnProps,
      entry: `${__dirname}/../lambdas/public/reviewTranslation.ts`,
      bundling: {
        externalModules: [],
      },
    });

    // Grant the translate function permission to use AWS Translate service
    translateReviewFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["translate:TranslateText"],
        resources: ["*"],
      })
    );

    const updateReviewFn = new lambdanode.NodejsFunction(this, "UpdateReviewFn", {
      ...appCommonFnProps,
      entry: `${__dirname}/../lambdas/private/updateReview.ts`,
    });

    const newReviewFn = new lambdanode.NodejsFunction(this, "AddReviewsFn", {
      ...appCommonFnProps,
      entry: `${__dirname}/../lambdas/private/addReviews.ts`,
    });

    const authorizerFn = new node.NodejsFunction(this, "AuthorizerFn", {
      ...appCommonFnProps,
      entry: "./lambdas/auth/authorizer.ts",
    });

    const requestAuthorizer = new apig.RequestAuthorizer(this, "RequestAuthorizer", {
      identitySources: [apig.IdentitySource.header("cookie")],
      handler: authorizerFn,
      resultsCacheTtl: cdk.Duration.minutes(0),
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
        physicalResourceId: custom.PhysicalResourceId.of("reviewsddbInitData"),
      },
      policy: custom.AwsCustomResourcePolicy.fromSdkCalls({
        resources: [reviewsTable.tableArn],
      }),
    });

    // Permissions
    reviewsTable.grantReadData(getReviewByIdFn);
    reviewsTable.grantReadData(getAllReviewsFn);
    reviewsTable.grantReadWriteData(newReviewFn);
    reviewsTable.grantReadWriteData(updateReviewFn);
    reviewsTable.grantReadData(translateReviewFn);

    // REST API
    const api = new apig.RestApi(this, "RestAPI", {
      description: "assignment api",
      deployOptions: { stageName: "dev" },
      defaultCorsPreflightOptions: {
        allowHeaders: ["Content-Type", "X-Amz-Date"],
        allowMethods: ["OPTIONS", "GET", "POST", "PUT", "PATCH", "DELETE"],
        allowCredentials: true,
        allowOrigins: ["*"],
      },
    });

    // Validators
    const requestValidator = new apig.RequestValidator(this, "RequestValidator", {
      restApi: api,
      validateRequestBody: true,
      validateRequestParameters: true,
    });

    const reviewModel = api.addModel("ReviewModel", {
      contentType: "application/json",
      modelName: "ReviewModel",
      schema: {
        schema: apig.JsonSchemaVersion.DRAFT4,
        title: "reviewModel",
        type: apig.JsonSchemaType.OBJECT,
        required: ["movieId", "reviewer_id", "content"],
        properties: {
          movieId: { type: apig.JsonSchemaType.NUMBER },
          reviewer_id: { type: apig.JsonSchemaType.STRING },
          content: { type: apig.JsonSchemaType.STRING },
          review_date: {
            type: apig.JsonSchemaType.STRING,
            pattern: "^\\d{4}-\\d{2}-\\d{2}$", // YYYY-MM-DD format
          },
        },
      },
    });

    // Reviews endpoint
    const moviesEndpoint = api.root.addResource("movies");
    const reviewsEndpoint = moviesEndpoint.addResource("reviews");
    const movieIdParam = reviewsEndpoint.addResource("{movieId}");
    const reviewIdParam = movieIdParam.addResource("{reviewId}");
    const translationResource = reviewIdParam.addResource("translation");

    // Methods
    reviewsEndpoint.addMethod("GET", new apig.LambdaIntegration(getAllReviewsFn));

    reviewsEndpoint.addMethod("POST", new apig.LambdaIntegration(newReviewFn), {
      authorizer: requestAuthorizer,
      authorizationType: apig.AuthorizationType.CUSTOM,
      requestModels: { "application/json": reviewModel },
      requestValidator,
    });

    reviewIdParam.addMethod("PUT", new apig.LambdaIntegration(updateReviewFn), {
      authorizer: requestAuthorizer,
      authorizationType: apig.AuthorizationType.CUSTOM,
      requestModels: { "application/json": reviewModel },
      requestValidator,
    });

    movieIdParam.addMethod("GET", new apig.LambdaIntegration(getReviewByIdFn), {
      requestValidator,
      requestParameters: { "method.request.path.movieId": true },
    });

    // Add the translation endpoint GET method
    translationResource.addMethod("GET", new apig.LambdaIntegration(translateReviewFn), {
      requestValidator,
      requestParameters: {
        "method.request.path.movieId": true,
        "method.request.path.reviewId": true,
        "method.request.querystring.language": true, // Required parameter
      },
    });
  }
}
