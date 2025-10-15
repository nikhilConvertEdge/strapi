import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

@Injectable()
export class ContentManagerService {
  constructor(private readonly contentManager: DataSource) { }

  // ------------------ CREATE ENTITY ------------------
  async create(collectionName: string, data: any) {
    const tableName = collectionName;
    const payload = data.attributes ?? data;

    // 1️⃣ Fetch schema metadata
    const [schemaRow] = await this.contentManager.query(
      `SELECT schema FROM schemas WHERE collection_name=$1`,
      [collectionName],
    );
    if (!schemaRow)
      throw new Error(`Schema not found for collection ${collectionName}`);

    const schemaJson = schemaRow.schema;
    const relationTables = schemaJson.relations ?? {};

    const componentEntries: { key: string; value: any }[] = [];
    const dynamicZoneEntries: { key: string; value: any }[] = [];
    const relationEntries: { key: string; value: any }[] = [];
    const normalData: any = {};

    // 2️⃣ Separate normal fields, components, dynamic zones, relations
    for (const key of Object.keys(payload)) {
      const value = payload[key];
      if (value?.type === 'component') {
        componentEntries.push({ key, value });
      } else if (key === 'dynamicZone' && Array.isArray(value)) {
        value.forEach((dzItem) => {
          const dzKey = Object.keys(dzItem)[0];
          dynamicZoneEntries.push({ key: dzKey, value: dzItem[dzKey] });
        });
      } else if (value?.type === 'relation') {
        relationEntries.push({ key, value });
      } else {
        normalData[key] = value;
      }
    }

    // 3️⃣ Insert main entity
    const entity = await this.insertEntity(tableName, normalData);
    const entityId = entity.id;

    // 4️⃣ Insert top-level components
    for (const { key, value } of componentEntries) {
      await this.insertComponent(tableName, entityId, key, value, key);
    }

    // 5️⃣ Insert dynamic zone components
    for (const { key, value } of dynamicZoneEntries) {
      await this.insertComponent(
        tableName,
        entityId,
        key,
        value,
        'dynamicZone',
      );
    }

    // 6️⃣ Insert relations
    for (const { key, value } of relationEntries) {
      await this.insertRelation(entityId, key, value, relationTables);
    }

    return entity;
  }

  // ------------------ INSERT COMPONENT (RECURSIVE) ------------------
  async insertComponent(
    parentTable: string,
    parentId: number,
    compKey: string,
    compData: any,
    field: string, // 'features' or 'dynamicZone'
  ) {
    // Determine component table name
    const componentName =
      compData.component?.replace(/-/g, '_') ?? compKey.replace(/-/g, '_');
    const componentTable = `component_${componentName}`;

    // 1️⃣ Insert normal fields into component table
    const cols = Object.keys(compData).filter(
      (k) =>
        !['type', 'component'].includes(k) && compData[k]?.type !== 'component',
    );
    const vals = cols.map((k) => compData[k]);

    const compInsertQuery = `
    INSERT INTO "${componentTable}" (${cols.map((c) => `"${c}"`).join(', ')})
    VALUES (${vals.map((_, i) => `$${i + 1}`).join(', ')})
    RETURNING *;
  `;
    const [compRow] = await this.contentManager.query(compInsertQuery, vals);

    // 2️⃣ Link component to parent in junction table
    const junctionTable = `${parentTable}_components`;
    await this.contentManager.query(
      `
    INSERT INTO "${junctionTable}" (entity_id, component_id, component_type, field)
    VALUES ($1, $2, $3, $4);
  `,
      [parentId, compRow.id, componentName, field],
    );

    // 3️⃣ Recursively insert nested components
    for (const key of Object.keys(compData)) {
      const val = compData[key];
      if (val?.type === 'component') {
        await this.insertComponent(componentTable, compRow.id, key, val, key);
      }
    }

    return compRow;
  }

  // ------------------ CREATE MAIN ENTITY ------------------
  async insertEntity(tableName: string, data: any) {
    const filteredData: any = {};
    for (const key of Object.keys(data)) {
      const value = data[key];
      if (typeof value === 'object' && value?.type) continue; // skip components/relations
      filteredData[key] =
        typeof value === 'object' ? JSON.stringify(value) : value;
    }

    const columns = Object.keys(filteredData);
    const values = Object.values(filteredData);
    const placeholders = columns.map((_, i) => `$${i + 1}`).join(',');

    const insertQuery = `
    INSERT INTO "${tableName}" (${columns.map((c) => `"${c}"`).join(', ')})
    VALUES (${placeholders})
    RETURNING *;
  `;
    const [entity] = await this.contentManager.query(insertQuery, values);
    return entity;
  }

  // ------------------ INSERT RELATIONS ------------------
  async insertRelation(
    entityId: number,
    relationKey: string,
    relationData: any,
    relationTables: any,
  ) {
    const relationInfo = relationTables[relationKey];
    if (!relationInfo)
      throw new Error(`Relation table not found for key ${relationKey}`);

    const junctionTable = relationInfo.junction; // Use junction table name
    await this.contentManager.query(
      `INSERT INTO "${junctionTable}" (entity_id, ${relationKey}_id) VALUES ($1, $2);`,
      [entityId, relationData.id],
    );
  }

  // ------------------ FIND ONE ------------------
  async findOne(collectionName: string, entityId: number) {
    // 1️⃣ Fetch schema metadata
    const [schemaRow] = await this.contentManager.query(
      `SELECT schema FROM schemas WHERE collection_name=$1`,
      [collectionName],
    );
    if (!schemaRow) throw new Error(`Schema not found for ${collectionName}`);

    const metadata = schemaRow.schema;
    const { components = {}, relations = {}, mainTable } = metadata;

    // 2️⃣ Fetch main entity
    const [entity] = await this.contentManager.query(
      `SELECT * FROM "${mainTable}" WHERE id=$1`,
      [entityId],
    );
    if (!entity) return null;

    // 3️⃣ Fetch components recursively
    const fetchedComponents = await this.fetchComponentsFromMetadata(
      mainTable,
      entityId,
      components,
    );

    // 4️⃣ Fetch relations
    const fetchedRelations = await this.fetchRelationsFromMetadata(
      entityId,
      relations,
    );

    // 5️⃣ Merge and return
    return { ...entity, ...fetchedComponents, ...fetchedRelations };
  }

  // ------------------ FETCH COMPONENTS RECURSIVELY ------------------

  async fetchComponentsFromMetadata(
    parentTable: string,
    parentId: number,
    componentsMeta: Record<string, string>,
  ) {
    const result: any = {};

    for (const [compKey, junctionTable] of Object.entries(componentsMeta)) {
      // 1️⃣ Get linked component rows from junction table
      const linkedRows = await this.contentManager.query(
        `SELECT component_id, component_type, field FROM "${junctionTable}" WHERE entity_id=$1`,
        [parentId],
      );
      if (!linkedRows.length) continue;

      for (const link of linkedRows) {
        const compTable = `component_${link.component_type.replace(/-/g, '_')}`;

        // 2️⃣ Fetch component data
        const [compRow] = await this.contentManager.query(
          `SELECT * FROM "${compTable}" WHERE id=$1`,
          [link.component_id],
        );
        if (!compRow) continue;

        // 3️⃣ Fetch nested component metadata from schemas
        const [compSchemaRow] = await this.contentManager.query(
          `SELECT schema FROM schemas WHERE collection_name=$1`,
          [link.component_type],
        );
        const compSchema = compSchemaRow?.schema;
        const nestedComponentsMeta = compSchema?.components || {};

        // 4️⃣ Recursively fetch nested components
        const nestedComponents = await this.fetchComponentsFromMetadata(
          compTable,
          compRow.id,
          nestedComponentsMeta,
        );

        // 5️⃣ Merge component data
        const compData = {
          type: link.component_type,
          ...compRow,
          ...nestedComponents,
        };

        // 6️⃣ Assign to result
        if (link.field === 'dynamicZone') {
          if (!result[link.field]) result[link.field] = [];
          result[link.field].push(compData);
        } else {
          result[link.field] = compData;
        }
      }
    }

    return result;
  }

  // ------------------ FETCH RELATIONS ------------------
  // ------------------ FETCH RELATIONS ------------------
  async fetchRelationsFromMetadata(
    entityId: number,
    relationsMeta: Record<string, { junction: string; target: string }>,
  ) {
    const result: Record<string, any> = {};

    for (const [key, relation] of Object.entries(relationsMeta)) {
      const junctionTable = relation.junction;
      const targetTable = relation.target;

      if (!junctionTable || !targetTable) {
        result[key] = null;
        continue;
      }

      // Safely get the column name (e.g., role_id)
      const columnName = `${key}_id`;

      const rows = await this.contentManager.query(
        `SELECT "${columnName}" FROM "${junctionTable}" WHERE entity_id = $1`,
        [entityId],
      );

      if (!rows.length) {
        result[key] = null;
        continue;
      }

      const relatedId = rows[0][columnName];

      const [relatedRow] = await this.contentManager.query(
        `SELECT * FROM "${targetTable}" WHERE id = $1`,
        [relatedId],
      );

      result[key] = relatedRow || null;
    }

    return result;
  }
}
