import { v4 as uuidv4 } from 'uuid';
import sha1 from 'sha1';
import dbClient from '../utils/db';
import redisClient from '../utils/redis';

const TOKEN_EXPIRATION = 24 * 60 * 60;

class AuthController {
  static async getConnect(req, res) {
    const authHeader = req.header('Authorization') || '';

    if (!authHeader.startsWith('Basic ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf-8');
    const separator = decoded.indexOf(':');

    if (separator === -1) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const email = decoded.slice(0, separator);
    const password = decoded.slice(separator + 1);

    if (!email || !password) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
      const user = await dbClient.db.collection('users').findOne({
        email,
        password: sha1(password),
      });

      if (!user) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const token = uuidv4();
      await redisClient.set(`auth_${token}`, user._id.toString(), TOKEN_EXPIRATION);

      return res.status(200).json({ token });
    } catch (err) {
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  static async getDisconnect(req, res) {
    const token = req.header('X-Token');

    if (!token) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
      const userId = await redisClient.get(`auth_${token}`);

      if (!userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      await redisClient.del(`auth_${token}`);

      return res.status(204).send();
    } catch (err) {
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
}

export default AuthController;