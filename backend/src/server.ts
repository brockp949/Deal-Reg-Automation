import express from 'express';
import routes from './api/routes';
import { apiKeyAuth } from './api/middleware/apiKeyAuth';

const app = express();
app.use(express.json());
app.use(apiKeyAuth);
app.use('/api', routes);

export default app;
