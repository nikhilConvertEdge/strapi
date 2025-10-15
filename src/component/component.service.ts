import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class ComponentService {
  constructor(private readonly dataSource: DataSource) { }



  async createComponent(collectionName: string, data: any) {
    const tableName = `component_${collectionName}`; // correct table name
    console.log(collectionName, 'tableExists');

    // 1️⃣ Check if table exists
    const tableExists = await this.dataSource.query(`
        SELECT to_regclass('${tableName}') as table_name;
    `);

    console.log(tableExists);

    // 2️⃣ Insert component data
    const cols = Object.keys(data.attributes || {});
    const vals = Object.values(data.attributes || {});
    const placeholders = cols.map((_, i) => `$${i + 1}`).join(',');
    const query = `INSERT INTO "${tableName}" (${cols.map((c) => `"${c}"`).join(',')})
                   VALUES (${placeholders}) RETURNING *;`;

    const [componentRow] = await this.dataSource.query(query, vals);
    return componentRow;
  }


}
