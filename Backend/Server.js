import express from "express";
import cors from "cors";
import dotenv from "dotenv";

import authRouter from "./Routes/auth.js";
import companiesRouter from "./Routes/companies.js";
import usersRouter from "./Routes/users.js";
import productsRouter from "./Routes/products.js";
import inventoryRouter from "./Routes/inventory.js";
import suppliersRouter from "./Routes/suppliers.js";
import salesRouter from "./Routes/Sales.js";
import ordersRouter from "./Routes/orders.js";
import deliveriesRouter from "./Routes/deliveries.js";
import posRouter from "./Routes/pos.js";
import restockRouter from "./Routes/restock.js";
import arRouter from "./Routes/ar.js";
import settingsRouter from "./Routes/settings.js";
import mobileHomeRouter from "./Routes/mobileHome.js";
import reportsRouter from "./Routes/reports.js";
import dataRouter from "./Routes/data.js";


dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

// Serve static 3D model binaries from /public/models
app.use("/public", express.static("public"));


const API_PREFIX = "/api/v1";

app.use(`${API_PREFIX}/auth`, authRouter);
app.use(`${API_PREFIX}/companies`, companiesRouter);
app.use(`${API_PREFIX}/users`, usersRouter);
app.use(`${API_PREFIX}/products`, productsRouter);
app.use(`${API_PREFIX}/inventory`, inventoryRouter);
app.use(`${API_PREFIX}/suppliers`, suppliersRouter);
app.use(`${API_PREFIX}/sales`, salesRouter);
app.use(`${API_PREFIX}/orders`, ordersRouter);
app.use(`${API_PREFIX}/deliveries`, deliveriesRouter);
app.use(`${API_PREFIX}/pos`, posRouter);
app.use(`${API_PREFIX}/ar`, arRouter);
app.use(`${API_PREFIX}/mobile`, mobileHomeRouter);
app.use(`${API_PREFIX}/reports`, reportsRouter);
app.use(`${API_PREFIX}/data`, dataRouter);
app.use(`${API_PREFIX}/restock`, restockRouter);
app.use(`${API_PREFIX}/settings`, settingsRouter);

app.get("/", (req, res) => {
    res.send("GasTrack API is running.");
});

app.listen(PORT, () => {
    console.log(`GasTrack API listening on http://localhost:${PORT}`);
});