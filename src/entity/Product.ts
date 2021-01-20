import {Entity, PrimaryGeneratedColumn, Column} from "typeorm";

@Entity()
export class Product {

    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    type: string;

    @Column()
    key: string;

    @Column()
    available: boolean;

}
