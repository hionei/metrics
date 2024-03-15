import express, { Application } from "express";
import cors from "cors";
import bodyParser from "body-parser";

export default (routes: any) => {
  const app: Application = express();
  app.use(cors());
  app.use(bodyParser.json());
  app.use(bodyParser.urlencoded({ extended: true }));
  app.use("/", routes);

  return app;
};
