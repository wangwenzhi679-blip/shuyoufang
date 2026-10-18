export async function saveMaterials(db, courseId, parsedFiles) {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const materials = [];
    for (const { file, extractedText, previewName, originalName } of parsedFiles) {
      const [result] = await connection.execute(
        'INSERT INTO course_materials(course_id,original_name,stored_name,mime_type,size_bytes,preview_name,extracted_text) VALUES(?,?,?,?,?,?,?)',
        [
          courseId,
          originalName,
          file.filename,
          file.mimetype || '',
          file.size,
          previewName,
          extractedText,
        ],
      );
      materials.push({
        id: result.insertId,
        original_name: originalName,
        mime_type: file.mimetype || '',
        size_bytes: file.size,
        preview_name: previewName,
        text_length: extractedText.length,
      });
    }
    await connection.commit();
    return materials;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
