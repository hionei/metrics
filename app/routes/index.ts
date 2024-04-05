import { Router } from "express";
import Controllers from "../controllers";

const router = Router();
const Songbird = new Controllers.Songbird();

router.get("/providers", Songbird.getProvidersInfo);
router.post("/enable-auto-claim", Songbird.enableAutoClaim);
router.post("/remove-auto-claim", Songbird.removeAutoClaim);
router.post("/add-new-user", Songbird.AddNewUser);

export default router;
