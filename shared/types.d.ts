// export type Language = 'English' | 'Frenc

export type Review =   {
  movieId: number;
  review_id: number;
  reviewer_id: string;
  review_date: string; // Format: YYYY-MM-DD
  content: string;
}


export type SignUpBody = {
  username: string;
  password: string;
  email: string
}

export type ConfirmSignUpBody = {
  username: string;
  code: string;
}

export type SignInBody = {
  username: string;
  password: string;
}

export type LanguageQueryParams = {
  language?: string;
};
 