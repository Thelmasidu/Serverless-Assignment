#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { ServerlessAssignmentStack } from "../lib/serverless-assignment";

const app = new cdk.App();
new ServerlessAssignmentStack(app, "ServerlessAssignmentStack", { env: { region: "eu-west-1" } });
