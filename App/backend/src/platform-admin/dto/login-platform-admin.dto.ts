import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class LoginPlatformAdminDto {
  @IsEmail({}, { message: 'email inválido' })
  email!: string;

  @IsString()
  @IsNotEmpty({ message: 'password es requerida' })
  password!: string;
}
