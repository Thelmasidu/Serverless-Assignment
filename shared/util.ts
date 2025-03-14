import { marshall } from "@aws-sdk/util-dynamodb";
import { Review } from "./types";


export const generateReviewItem = (review: Review) => {
  return {
    PutRequest: {
      Item: marshall(review),
    },
  };
};

export const generateBatch = (data: Review[]) => {
  return data.map((e) => {
    return generateReviewItem(e);
  });
};

