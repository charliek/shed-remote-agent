import { Hono } from 'hono';
import hosts from './hosts.js';
import images from './images.js';
import rc from './rc.js';
import repos from './repos.js';
import sheds from './sheds.js';
import workspaces from './workspaces.js';

const routes = new Hono();

routes.route('/hosts', hosts);
routes.route('/sheds', sheds);
routes.route('/sheds', rc);
routes.route('/hosts', images);
routes.route('/hosts', workspaces);
routes.route('/repos', repos);

export default routes;
