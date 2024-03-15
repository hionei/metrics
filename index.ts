import dotenv from "dotenv";
import express from "./app/services/express";
import { Application } from "express";
import routes from "./app/routes";
//For env File
dotenv.config();

const app: Application = express(routes);
const port = process.env.PORT || 8000;

app.listen(port, () => {
  console.log(`Server is Fire at http://localhost:${port}`);
});
