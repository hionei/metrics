import { Router } from "express";
import Controllers from "../controllers";

const router = Router();
const Read = new Controllers.Read();
Read.runGettingDelegatorsInfo();

router.get("/top_10_vp", Read.top_10_vp);

export default router;
