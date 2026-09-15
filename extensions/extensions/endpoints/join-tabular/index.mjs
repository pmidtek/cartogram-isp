import multer from 'multer';
import csvParser from 'csv-parser';
import { createObjectCsvStringifier } from 'csv-writer';
import { Readable } from 'stream';
import { InvalidPayloadError } from '@directus/errors';

const upload = multer(); // Define multer once at the top

// Utility function to parse CSV from buffer
function parseCSV(buffer) {
  return new Promise((resolve, reject) => {
    const results = [];
    const stream = Readable.from(buffer.toString()).pipe(csvParser());

    stream.on('data', (row) => results.push(row));
    stream.on('end', () => resolve(results));
    stream.on('error', reject);
  });
}

export default (router, { logger }) => {
  // Add the multer middleware directly to the route
  router.get('/',(req,res,next)=>{
    logger.info("join-tabular works!")
    return res.json({
      msg:"success to access join tabular",
      status: "ok"
    })
  }),
  router.post(
    '/',
    upload.fields([{ name: 'target' }, { name: 'join' }]),
    async (req, res, next) => {
      const { id_target: idTarget, id_join: idJoin, output_name:outputName } = req.body;

      if (!idTarget || !idJoin || !req.files?.target || !req.files?.join) {
        return next(new InvalidPayloadError('Missing required files or fields'));
      }

      try {
        const targetRows = await parseCSV(req.files.target[0].buffer);
        const joinRows = await parseCSV(req.files.join[0].buffer);

        // Build join map
        const joinMap = new Map(joinRows.map((row) => [row[idJoin], row]));

        // Perform join
        const joinedRows = targetRows
          .map((targetRow) => {
            const joinRow = joinMap.get(targetRow[idTarget]);
            if (!joinRow) return null;
            return { ...targetRow, ...joinRow };
          })
          .filter(Boolean);

        if (joinedRows.length === 0) {
          return res.status(204).json({ message: 'No matching rows found' });
        }

        // Get all unique columns
        const allFields = new Set();
        joinedRows.forEach((row) => {
          Object.keys(row).forEach((key) => allFields.add(key));
        });

        const csvStringifier = createObjectCsvStringifier({
          header: Array.from(allFields).map((field) => ({ id: field, title: field })),
        });

        const csvOutput =
          csvStringifier.getHeaderString() + csvStringifier.stringifyRecords(joinedRows);

        // Return CSV as file download with safe filename
        const safeOutputName = (outputName && outputName.trim()) ? outputName.trim() : 'joined';
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="${safeOutputName}.csv"`);
        res.send(csvOutput);

      } catch (err) {
        logger.error(err);
        return next(new InvalidPayloadError('Failed to join CSV files'));
      }
    }
  );
};
