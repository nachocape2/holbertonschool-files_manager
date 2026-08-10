import { promises as fs } from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import pkg from 'mongodb';
import dbClient from '../utils/db';
import redisClient from '../utils/redis';

const { ObjectId } = pkg;

const ACCEPTED_TYPES = ['folder', 'file', 'image'];
const ROOT_ID = 0;
const ROOT_MATCH = [0, '0'];
const PAGE_SIZE = 20;

const getUserId = async (req) => {
  const token = req.header('X-Token');

  if (!token) {
    return null;
  }

  return redisClient.get(`auth_${token}`);
};

const formatFile = (doc) => ({
  id: doc._id.toString(),
  userId: doc.userId.toString(),
  name: doc.name,
  type: doc.type,
  isPublic: doc.isPublic || false,
  parentId: ROOT_MATCH.includes(doc.parentId) ? 0 : doc.parentId.toString(),
});

class FilesController {
  static async postUpload(req, res) {
    const userId = await getUserId(req);

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

    const isRoot = ROOT_MATCH.includes(parentId);

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

  static async getShow(req, res) {
    const userId = await getUserId(req);

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
      const file = await dbClient.db.collection('files').findOne({
        _id: new ObjectId(req.params.id),
        userId: new ObjectId(userId),
      });

      if (!file) {
        return res.status(404).json({ error: 'Not found' });
      }

      return res.status(200).json(formatFile(file));
    } catch (err) {
      return res.status(404).json({ error: 'Not found' });
    }
  }

  static async getIndex(req, res) {
    const userId = await getUserId(req);

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { parentId = 0 } = req.query;
    const page = parseInt(req.query.page, 10) || 0;

    const isRoot = ROOT_MATCH.includes(parentId);

    let parentMatch;

    if (isRoot) {
      parentMatch = { $in: ROOT_MATCH };
    } else {
      try {
        parentMatch = new ObjectId(parentId);
      } catch (err) {
        return res.status(200).json([]);
      }
    }

    try {
      const files = await dbClient.db.collection('files').aggregate([
        { $match: { userId: new ObjectId(userId), parentId: parentMatch } },
        { $skip: page * PAGE_SIZE },
        { $limit: PAGE_SIZE },
      ]).toArray();

      return res.status(200).json(files.map(formatFile));
    } catch (err) {
      return res.status(200).json([]);
    }
  }
}

export default FilesController;