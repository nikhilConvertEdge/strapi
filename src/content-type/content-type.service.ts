import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ComponentService } from 'src/component/component.service';

@Injectable()
export class ContentTypeService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly componentService: ComponentService,
  ) { }

  async create(collectionName: string, data: any) {
    const tableName = collectionName;
    const payload = data.attributes ?? data;

    // Fetch schema
    const [schemaRow] = await this.dataSource.query(
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

    // Separate normal fields, components, dynamic zones, relations
    for (const key of Object.keys(payload)) {
      const value = payload[key];
      if (value?.type === 'component') componentEntries.push({ key, value });
      else if (key === 'dynamicZone' && Array.isArray(value)) {
        value.forEach((dzItem) => {
          const dzKey = Object.keys(dzItem)[0];
          const dzValue = dzItem[dzKey];
          dynamicZoneEntries.push({ key: dzKey, value: dzValue });
        });
      } else if (value?.type === 'relation') relationEntries.push({ key, value });
      else normalData[key] = value;
    }

    // 1️⃣ Insert main entity
    const entity = await this.insertEntity(tableName, normalData);
    const entityId = entity.id;

    // 2️⃣ Insert top-level components
    for (const { key, value } of componentEntries) {
      await this.insertComponent(tableName, entityId, key, value, key); // field = key
    }

    // 3️⃣ Insert dynamic zone components
    for (const { key, value } of dynamicZoneEntries) {
      await this.insertComponent(tableName, entityId, key, value, 'dynamicZone'); // field = 'dynamicZone'
    }

    // 4️⃣ Insert relations
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
    field: string // field to store in junction table
  ) {
    const componentName =
      compData.component?.replace(/-/g, '_') ?? compKey.replace(/-/g, '_');
    const componentTable = `component_${componentName}`;

    // Normal fields
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
    const [compRow] = await this.dataSource.query(compInsertQuery, vals);

    // Link to parent entity with proper field
    const junctionTable = `${parentTable}_components`;
    await this.dataSource.query(
      `INSERT INTO "${junctionTable}" (entity_id, component_id, component_type, field)
     VALUES ($1, $2, $3, $4);`,
      [parentId, compRow.id, componentName, field],
    );

    // Recursively insert nested components
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
    const [entity] = await this.dataSource.query(insertQuery, values);
    return entity;
  }


  // ------------------ INSERT RELATIONS ------------------
  async insertRelation(
    entityId: number,
    relationKey: string,
    relationData: any,
    relationTables: any,
  ) {
    const relationTable = relationTables[relationKey];
    if (!relationTable)
      throw new Error(`Relation table not found for key ${relationKey}`);
    await this.dataSource.query(
      `INSERT INTO "${relationTable}" (entity_id, ${relationKey}_id) VALUES ($1, $2);`,
      [entityId, relationData.id],
    );
  }

  // ------------------ FETCH MAIN ENTITY ------------------

  // ------------------ FIND ONE ------------------
  async findOne(collectionName: string, entityId: number) {
    // 1️⃣ Fetch schema metadata
    const [schemaRow] = await this.dataSource.query(
      `SELECT schema FROM schemas WHERE collection_name=$1`,
      [collectionName],
    );
    if (!schemaRow) throw new Error(`Schema not found for ${collectionName}`);

    const metadata = schemaRow.schema;
    const { components = {}, relations = {}, mainTable } = metadata;

    // 2️⃣ Fetch main entity
    const [entity] = await this.dataSource.query(
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



  async fetchComponentsFromMetadata(
    parentTable: string,
    parentId: number,
    componentsMeta: Record<string, string>,
  ) {
    const result: any = {};
    const dynamicZoneArray: any[] = [];

    for (const [compKey, junctionTable] of Object.entries(componentsMeta)) {
      const linked = await this.dataSource.query(
        `SELECT component_id, component_type, field FROM "${junctionTable}" WHERE entity_id=$1`,
        [parentId],
      );
      if (!linked.length) continue;

      for (const link of linked) {
        const compTable = `component_${link.component_type.replace(/-/g, '_')}`;
        const [compRow] = await this.dataSource.query(
          `SELECT * FROM "${compTable}" WHERE id=$1`,
          [link.component_id],
        );
        if (!compRow) continue;

        // -----------------------------
        // ONLY pass empty meta for nested components
        // -----------------------------
        const nestedComponents = await this.fetchComponentsFromMetadata(
          compTable,
          compRow.id,
          {}, // avoid looping over unrelated top-level components
        );

        const compData = { ...compRow, ...nestedComponents };

        if (link.field !== 'dynamicZone') {
          result[link.field] = compData;
        } else {
          dynamicZoneArray.push({ [link.component_type]: compData });
        }
      }
    }

    if (dynamicZoneArray.length) result['dynamicZone'] = dynamicZoneArray;
    return result;
  }



  // ------------------ FETCH RELATIONS ------------------
  async fetchRelationsFromMetadata(
    entityId: number,
    relationsMeta: Record<string, { junction: string; target: string }>,
  ) {
    const result: any = {};

    for (const [key, { junction, target }] of Object.entries(relationsMeta)) {
      // 1️⃣ Get related IDs from junction
      const rows = await this.dataSource.query(
        `SELECT ${key}_id FROM "${junction}" WHERE entity_id=$1`,
        [entityId],
      );
      const ids = rows.map((r: any) => r[`${key}_id`]);
      if (!ids.length) {
        result[key] = null;
        continue;
      }

      // 2️⃣ Fetch target table rows
      const relatedRows = await this.dataSource.query(
        `SELECT * FROM "${target}" WHERE id = ANY($1)`,
        [ids],
      );

      result[key] = relatedRows.length === 1 ? relatedRows[0] : relatedRows;
    }

    return result;
  }
}
