import { promises as fs } from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import pkg from 'mongodb';
import dbClient from '../utils/db';
import redisClient from '../utils/redis';

const { ObjectId } = pkg;

const ACCEPTED_TYPES = ['folder', 'file', 'image'];
const ROOT_ID = '0';

class FilesController {
  static async postUpload(req, res) {
    const token = req.header('X-Token');

    if (!token) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const userId = await redisClient.get(`auth_${token}`);

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const {
      name,
      type,
      data,
      parentId = 0,
      isPublic = false,
    } = req.body || {};

    if (!name) {
      return res.status(400).json({ error: 'Missing name' });
    }

    if (!type || !ACCEPTED_TYPES.includes(type)) {
      return res.status(400).json({ error: 'Missing type' });
    }

    if (!data && type !== 'folder') {
      return res.status(400).json({ error: 'Missing data' });
    }

    const isRoot = parentId === 0 || parentId === ROOT_ID;

    try {
      const files = dbClient.db.collection('files');

      if (!isRoot) {
        let parent = null;

        try {
          parent = await files.findOne({ _id: new ObjectId(parentId) });
        } catch (err) {
          parent = null;
        }

        if (!parent) {
          return res.status(400).json({ error: 'Parent not found' });
        }

        if (parent.type !== 'folder') {
          return res.status(400).json({ error: 'Parent is not a folder' });
        }
      }

      const document = {
        userId: new ObjectId(userId),
        name,
        type,
        isPublic,
        parentId: isRoot ? ROOT_ID : new ObjectId(parentId),
      };

      if (type !== 'folder') {
        const folderPath = path.resolve(process.env.FOLDER_PATH || '/tmp/files_manager');

        await fs.mkdir(folderPath, { recursive: true });

        const localPath = path.join(folderPath, uuidv4());
        await fs.writeFile(localPath, Buffer.from(data, 'base64'));

        document.localPath = localPath;
      }

      const result = await files.insertOne(document);

      return res.status(201).json({
        id: result.insertedId.toString(),
        userId,
        name,
        type,
        isPublic,
        parentId: isRoot ? 0 : parentId.toString(),
      });
    } catch (err) {
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
}

export default FilesController;