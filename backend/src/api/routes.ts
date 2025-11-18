import { Router } from 'express';
import opportunitiesRouter from './opportunitiesRouter';

const routes = Router();
routes.use('/opportunities', opportunitiesRouter);

export default routes;
