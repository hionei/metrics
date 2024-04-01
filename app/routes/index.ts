import { Router } from "express";
import Controllers from "../controllers";

const router = Router();
// const Read = new Controllers.Read();
const Songbird = new Controllers.Songbird();
// const Flare = new Controllers.Flare();

// router.get("/flare/providers", Flare.getProvidersInfo);
router.get("/songbird/providers", Songbird.getProvidersInfo);

// router.get("/top_10_vp", Read.top_10_vp);
// router.get("/get_top10_locked_VP", Read.top_10_locked_vp);
// router.get("/is_in_top10/:address", Read.isInTop10);
// router.get("/api/flare/info", Read.getFlareProvidersInfo);
// router.get("/api/songbird/info", Read.getSongbirdProvidersInfo);
export default router;
